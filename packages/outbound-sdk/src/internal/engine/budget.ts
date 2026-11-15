// One budget per credential. A request must fit every declared window, the
// lane's own windows when it has one, and the concurrency cap. After a 429
// the lane pauses and the rate halves, then climbs back slowly.

import { OutboundError } from "../errors.ts";
import { fire } from "../hooks.ts";
import type { OutboundHooks } from "../hooks.ts";
import { DEFAULT_CONCURRENCY, scaleWindow } from "../limits.ts";
import type { LimitDeclaration, RateWindow } from "../limits.ts";
import type { RateLimitStore } from "./rate-store.ts";
import { abortedError, sleep } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";

export const DEFAULT_LANE = "default";

const MIN_FACTOR = 0.1;
const RECOVERY_STEP = 0.05;

export interface AcquireOptions {
  readonly lane: string;
  readonly runtime: Runtime;
  readonly hooks: OutboundHooks;
  readonly signal?: AbortSignal | undefined;
  /** An epoch in milliseconds after which waiting is pointless. */
  readonly deadlineAt?: number | undefined;
}

export interface BudgetWindowUsage {
  readonly lane: string;
  /** Requests allowed in the window after `share` and any slowdown. */
  readonly requests: number;
  readonly perMs: number;
  readonly used: number;
}

export interface BudgetOptions {
  readonly key: string;
  readonly provider: string;
  readonly limits: LimitDeclaration;
  readonly share: number;
  readonly store: RateLimitStore;
}

export class Budget {
  readonly #options: BudgetOptions;
  readonly #waiting: (() => void)[] = [];
  #inFlight = 0;
  /** Drops to slow down after a 429, then recovers toward 1. */
  #factor = 1;

  constructor(options: BudgetOptions) {
    this.#options = options;
  }

  #windows(lane: string): readonly RateWindow[] {
    const { limits, share } = this.#options;

    const declared =
      lane === DEFAULT_LANE ? limits.windows : (limits.lanes?.[lane] ?? []);

    return declared.map((window) => scaleWindow(window, share * this.#factor));
  }

  #storeKey(lane: string): string {
    return lane === DEFAULT_LANE
      ? this.#options.key
      : `${this.#options.key}#${lane}`;
  }

  async #reserve(lane: string, now: number): Promise<number> {
    const { store } = this.#options;

    if (lane !== DEFAULT_LANE) {
      const laneWait = await store.reserve(
        this.#storeKey(lane),
        this.#windows(lane),
        now
      );

      if (laneWait > 0) {
        return laneWait;
      }
    }

    return await store.reserve(
      this.#options.key,
      this.#windows(DEFAULT_LANE),
      now
    );
  }

  async #enter(options: AcquireOptions): Promise<void> {
    const cap = this.#options.limits.concurrency ?? DEFAULT_CONCURRENCY;

    if (this.#inFlight < cap) {
      this.#inFlight += 1;

      return;
    }

    // oxlint-disable-next-line promise/avoid-new -- a queue slot is resolved by release().
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.#waiting.indexOf(enter);

        if (index !== -1) {
          this.#waiting.splice(index, 1);
        }

        reject(abortedError(this.#options.provider));
      };

      const enter = (): void => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      };

      this.#waiting.push(enter);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Waits for a concurrency slot and for room in every window. Returns how
   * long it waited. The caller must call `release()` afterwards.
   */
  async acquire(options: AcquireOptions): Promise<number> {
    const { provider } = this.#options;
    const { deadlineAt, hooks, lane, runtime, signal } = options;

    if (signal?.aborted) {
      throw abortedError(provider);
    }

    await this.#enter(options);
    let waited = 0;

    try {
      for (;;) {
        const now = runtime.now();
        // oxlint-disable-next-line no-await-in-loop -- each wait depends on the previous one.
        const waitMs = await this.#reserve(lane, now);

        if (waitMs === 0) {
          return waited;
        }

        if (deadlineAt !== undefined && now + waitMs > deadlineAt) {
          throw new OutboundError(
            "RateLimited",
            `${provider} rate budget is full and the deadline would pass before it frees up`,
            {
              limit: "deadline",
              provider,
              retryAfterMs: waitMs,
              timedOut: true,
            }
          );
        }

        fire(hooks.onThrottle, { lane, provider, waitMs });
        // oxlint-disable-next-line no-await-in-loop -- waiting is the point.
        await sleep(runtime, waitMs, provider, signal);
        waited += waitMs;
      }
    } catch (error) {
      this.release();
      throw error;
    }
  }

  release(): void {
    const resume = this.#waiting.shift();

    if (resume === undefined) {
      this.#inFlight = Math.max(0, this.#inFlight - 1);
    } else {
      resume();
    }
  }

  /** Called on a 429: pause the lane and halve the rate. */
  async rateLimited(
    lane: string,
    retryAfterMs: number,
    now: number
  ): Promise<void> {
    this.#factor = Math.max(MIN_FACTOR, this.#factor / 2);
    await this.#options.store.pause(this.#storeKey(lane), now + retryAfterMs);
  }

  /** Called when the vendor's headers say the window is spent. */
  async exhausted(resetInMs: number, now: number): Promise<void> {
    await this.#options.store.pause(this.#options.key, now + resetInMs);
  }

  /** Called on a success: climb back toward the declared rate. */
  succeeded(): void {
    this.#factor = Math.min(1, this.#factor + RECOVERY_STEP);
  }

  async usage(now: number): Promise<BudgetWindowUsage[]> {
    const lanes = [
      DEFAULT_LANE,
      ...Object.keys(this.#options.limits.lanes ?? {}),
    ];

    const perLane = await Promise.all(
      lanes.map(async (lane) => {
        const windows = this.#windows(lane);

        const used = await this.#options.store.usage(
          this.#storeKey(lane),
          windows,
          now
        );

        return windows.map((window, index) => ({
          lane,
          perMs: window.perMs,
          requests: window.requests,
          used: used[index] ?? 0,
        }));
      })
    );

    return perLane.flat();
  }
}
