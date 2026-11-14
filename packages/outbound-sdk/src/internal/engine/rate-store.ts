// Where rate budgets are counted. In memory by default; implement
// RateLimitStore on Redis, Cloudflare KV or a Durable Object so many workers
// share one budget.

import type { RateWindow } from "../limits.ts";

export interface RateLimitStore {
  /**
   * Reserves one request in every window for `key`. Returns 0 when the
   * request may go now, otherwise how many milliseconds to wait before
   * trying again. Nothing is reserved when it returns a wait.
   */
  readonly reserve: (
    key: string,
    windows: readonly RateWindow[],
    now: number
  ) => Promise<number>;
  /** Blocks `key` until `until` (an epoch in milliseconds), after a 429. */
  readonly pause: (key: string, until: number) => Promise<void>;
  /** Requests counted in each window right now, in the order given. */
  readonly usage: (
    key: string,
    windows: readonly RateWindow[],
    now: number
  ) => Promise<number[]>;
}

interface Bucket {
  /** Request times, oldest first. */
  times: number[];
  pausedUntil: number;
}

// The first index whose time is inside the window.
const firstInside = (times: readonly number[], cutoff: number): number => {
  let low = 0;
  let high = times.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if ((times[middle] ?? 0) > cutoff) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
};

const waitFor = (bucket: Bucket, window: RateWindow, now: number): number => {
  const start = firstInside(bucket.times, now - window.perMs);
  const used = bucket.times.length - start;

  if (used < window.requests) {
    return 0;
  }

  // The request that must leave the window before another fits.
  const blocker = bucket.times[bucket.times.length - window.requests] ?? now;

  return Math.max(1, blocker + window.perMs - now);
};

/** A sliding-window log per key, held in this process. */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, Bucket>();

  #bucket(key: string): Bucket {
    let bucket = this.#buckets.get(key);

    if (bucket === undefined) {
      bucket = { pausedUntil: 0, times: [] };
      this.#buckets.set(key, bucket);
    }

    return bucket;
  }

  reserve(
    key: string,
    windows: readonly RateWindow[],
    now: number
  ): Promise<number> {
    const bucket = this.#bucket(key);

    if (bucket.pausedUntil > now) {
      return Promise.resolve(bucket.pausedUntil - now);
    }

    const wait = Math.max(
      0,
      ...windows.map((window) => waitFor(bucket, window, now))
    );

    if (wait > 0) {
      return Promise.resolve(wait);
    }

    const longest = Math.max(0, ...windows.map((window) => window.perMs));
    bucket.times = bucket.times.slice(firstInside(bucket.times, now - longest));
    bucket.times.push(now);

    return Promise.resolve(0);
  }

  pause(key: string, until: number): Promise<void> {
    const bucket = this.#bucket(key);
    bucket.pausedUntil = Math.max(bucket.pausedUntil, until);

    return Promise.resolve();
  }

  usage(
    key: string,
    windows: readonly RateWindow[],
    now: number
  ): Promise<number[]> {
    const bucket = this.#bucket(key);

    return Promise.resolve(
      windows.map(
        (window) =>
          bucket.times.length - firstInside(bucket.times, now - window.perMs)
      )
    );
  }
}

const GLOBAL_STORE = Symbol.for("outbound-sdk.rate-limit-store");

interface GlobalWithStore {
  [GLOBAL_STORE]?: MemoryRateLimitStore;
}

/**
 * The process-wide store, so every instance on one credential shares one
 * budget even when the package is bundled more than once.
 */
export const defaultRateLimitStore = (): RateLimitStore => {
  // SAFETY: globalThis is an open object; the symbol key is ours alone.
  const scope = globalThis as GlobalWithStore;
  scope[GLOBAL_STORE] ??= new MemoryRateLimitStore();

  return scope[GLOBAL_STORE];
};
