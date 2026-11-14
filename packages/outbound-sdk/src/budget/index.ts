// outbound-sdk/budget: caps vendor requests, so an agent cannot spend the
// whole rate limit on one question. List it last so it sits next to the
// request engine.
//
// The cap is enforced inside the engine, request by request: a call that
// reaches it stops with `RateLimited` and says how many requests it used.

import { callerLimit, OutboundError } from "../internal/errors.ts";
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
  // Requests counted live for each call, as the engine sends them.
  const live = new WeakMap<object, number>();

  const spent = (provider: string): OutboundError =>
    callerLimit(
      new OutboundError(
        "RateLimited",
        `The run used its budget of ${options.maxRequests} request(s) to ${provider}`,
        { provider }
      )
    );

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

      if (perRun && remaining() === 0) {
        throw spent(info.provider);
      }

      if (!perRun) {
        // The engine stops the call once it has made this many requests.
        state.maxRequests = Math.min(
          state.maxRequests ?? options.maxRequests,
          options.maxRequests
        );
      }

      if (!live.has(state)) {
        live.set(state, 0);
        const prior = state.beforeRequest;

        // Counted as each request is sent, so calls running side by side
        // share one allowance and a run never goes past it.
        state.beforeRequest = () => {
          prior?.();

          if (perRun && remaining() === 0) {
            throw spent(info.provider);
          }

          used += 1;
          live.set(state, (live.get(state) ?? 0) + 1);
        };
      }

      const before = state.requests;
      const liveBefore = live.get(state) ?? 0;

      try {
        return await next(operation);
      } finally {
        // A plugin inside this one may record a request on the state itself,
        // without the engine sending one; that request is counted here.
        const recorded = state.requests - before;
        const sent = (live.get(state) ?? 0) - liveBefore;
        used += Math.max(0, recorded - sent);
      }
    },
  };
};
