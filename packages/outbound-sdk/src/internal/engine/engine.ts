// The request engine: every HTTP call from every adapter goes through here.

import type { Adapter, AdapterContext } from "../adapter.ts";
import { OutboundError } from "../errors.ts";
import type { OutboundHooks } from "../hooks.ts";
import { DEFAULT_SHARE } from "../limits.ts";
import { sha256Hex } from "../sha256.ts";
import { Budget } from "./budget.ts";
import type { BudgetWindowUsage } from "./budget.ts";
import { defaultRateLimitStore } from "./rate-store.ts";
import type { RateLimitStore } from "./rate-store.ts";
import { DEFAULT_TIMEOUT_MS, execute } from "./request.ts";
import type { CallState } from "./request.ts";
import { resolveRetryPolicy } from "./retry.ts";
import type { RetriesOption } from "./retry.ts";
import { defaultRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";

/** Options every call accepts. Set defaults on the constructor. */
export interface OperationOptions {
  readonly signal?: AbortSignal | undefined;
  /** Milliseconds allowed for each attempt. Defaults to 30,000. */
  readonly timeout?: number | undefined;
  /** Retries after the first attempt, or a policy. Defaults to 4. */
  readonly retries?: RetriesOption | undefined;
  /** A total time budget in milliseconds, across retries and throttle waits. */
  readonly deadline?: number | undefined;
  /** Stop after this many vendor requests, so one question cannot spend the limit. */
  readonly maxRequests?: number | undefined;
}

export interface EngineOptions {
  readonly runtime?: Partial<Runtime> | undefined;
  readonly store?: RateLimitStore | undefined;
  readonly hooks?: OutboundHooks | undefined;
  /** The fraction of each vendor's published limit to use. Defaults to 0.5. */
  readonly share?: number | undefined;
  readonly defaults?: OperationOptions | undefined;
}

export interface LimitsSnapshot {
  readonly provider: string;
  readonly workspaceId: string;
  readonly share: number;
  readonly windows: readonly BudgetWindowUsage[];
  /** Where the adapter's declared numbers came from. */
  readonly source: string;
}

// Budgets are shared by every engine using the same store, so ten instances
// on one credential draw from one budget.
const BUDGETS = Symbol.for("outbound-sdk.budgets");

interface GlobalWithBudgets {
  [BUDGETS]?: WeakMap<RateLimitStore, Map<string, Budget>>;
}

const budgetsFor = (store: RateLimitStore): Map<string, Budget> => {
  // SAFETY: globalThis is an open object; the symbol key is ours alone.
  const scope = globalThis as GlobalWithBudgets;
  scope[BUDGETS] ??= new WeakMap();
  let budgets = scope[BUDGETS].get(store);

  if (budgets === undefined) {
    budgets = new Map();
    scope[BUDGETS].set(store, budgets);
  }

  return budgets;
};

const credentialKey = (adapter: Adapter): string =>
  adapter.secrets.length === 0
    ? `${adapter.name}:${adapter.workspaceId}`
    : `${adapter.name}:${sha256Hex(adapter.secrets.join("\u001F")).slice(0, 24)}`;

export class RequestEngine {
  readonly #runtime: Runtime;
  readonly #store: RateLimitStore;
  readonly #hooks: OutboundHooks;
  readonly #share: number;
  readonly #defaults: OperationOptions;

  constructor(options: EngineOptions = {}) {
    this.#runtime = { ...defaultRuntime, ...options.runtime };
    this.#store = options.store ?? defaultRateLimitStore();
    this.#hooks = options.hooks ?? {};
    this.#share = options.share ?? DEFAULT_SHARE;
    this.#defaults = options.defaults ?? {};

    if (!(this.#share > 0 && this.#share <= 1)) {
      throw new OutboundError(
        "Invalid",
        "share must be greater than 0 and at most 1"
      );
    }
  }

  get hooks(): OutboundHooks {
    return this.#hooks;
  }

  now(): number {
    return this.#runtime.now();
  }

  #budget(adapter: Adapter): Budget {
    const budgets = budgetsFor(this.#store);
    const key = credentialKey(adapter);
    let budget = budgets.get(key);

    if (budget === undefined) {
      budget = new Budget({
        key,
        limits: adapter.limits,
        provider: adapter.name,
        share: this.#share,
        store: this.#store,
      });
      budgets.set(key, budget);
    }

    return budget;
  }

  /** Starts the accounting for one SDK call. */
  begin(options: OperationOptions = {}): CallState {
    const merged = { ...this.#defaults, ...options };

    return {
      deadlineAt:
        merged.deadline === undefined
          ? undefined
          : this.now() + merged.deadline,
      maxRequests: merged.maxRequests,
      requests: 0,
      retry: resolveRetryPolicy(merged.retries),
      signal: merged.signal,
      throttledMs: 0,
      timeoutMs: merged.timeout ?? DEFAULT_TIMEOUT_MS,
    };
  }

  contextFor(adapter: Adapter, state: CallState): AdapterContext {
    return {
      forAdapter: (other) => this.contextFor(other, state),
      request: (spec) =>
        execute(spec, {
          adapter,
          budget: this.#budget(adapter),
          hooks: this.#hooks,
          runtime: this.#runtime,
          state,
        }),
    };
  }

  async limits(adapter: Adapter): Promise<LimitsSnapshot> {
    return {
      provider: adapter.name,
      share: this.#share,
      source: adapter.limits.source,
      windows: await this.#budget(adapter).usage(this.now()),
      workspaceId: adapter.workspaceId,
    };
  }
}
