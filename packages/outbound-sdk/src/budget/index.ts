// outbound-sdk/budget: caps vendor requests, so an agent cannot spend the
// whole rate limit on one question. List it last so it sits next to the
// request engine.
//
// The cap is enforced inside the engine, request by request: a call that
// reaches it stops with `RateLimited` and says how many requests it used.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface BudgetOptions {
  /** The most vendor requests allowed. */
  readonly maxRequests: number;
  /**
   * `call` allows `maxRequests` for each SDK call. `run` allows it in total
   * across every call on the instance, until `reset()`.
   */
  readonly per?: "call" | "run" | undefined;
}

export interface BudgetExtension {
  readonly requestBudget: {
    /** Requests counted against a `run` budget so far. */
    readonly used: () => number;
    readonly remaining: () => number;
    /** Starts a new run. */
    readonly reset: () => void;
  };
}

/** Caps vendor requests per call or per run. */
export const budget = (
  options: BudgetOptions
): OutboundPlugin<BudgetExtension> => {
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new OutboundError(
      "Invalid",
      "budget() needs maxRequests to be a positive integer"
    );
  }

  const perRun = options.per === "run";
  let used = 0;
  const remaining = (): number => Math.max(0, options.maxRequests - used);

  return {
    extend: () => ({
      requestBudget: {
        remaining,
        reset: () => {
          used = 0;
        },
        used: () => used,
      },
    }),
    name: "budget",
    wrap: async (operation, next, info) => {
      const { state } = info;
      const before = state.requests;

      if (perRun && remaining() === 0) {
        throw new OutboundError(
          "RateLimited",
          `The run used its budget of ${options.maxRequests} request(s) to ${info.provider}`,
          { provider: info.provider }
        );
      }

      // The engine stops the call once it has made this many requests.
      const allowed = perRun ? before + remaining() : options.maxRequests;
      state.maxRequests = Math.min(state.maxRequests ?? allowed, allowed);

      try {
        return await next(operation);
      } finally {
        used += state.requests - before;
      }
    },
  };
};
