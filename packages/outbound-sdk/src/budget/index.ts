// outbound-sdk/budget: caps vendor requests, so an agent cannot spend the
// whole rate limit on one question. List it last so it sits next to the
// request engine.
//
// The cap is enforced inside the engine, request by request: a call that
// reaches it stops with `RateLimited`, `limit` "call" or "run", and
// `permanent: true`, because retrying stops at the same place.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { plural } from "../internal/plural.ts";

export interface BudgetOptions {
  /** The most vendor requests allowed. */
  readonly maxRequests: number;
  /**
   * `run` (the default) allows `maxRequests` in total across every call on
   * the instance, until `reset()`. `call` allows it for each SDK call, as
   * `maxRequestsPerCall` on `createOutbound` does.
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

  const perRun = options.per !== "call";
  let used = 0;
  const remaining = (): number => Math.max(0, options.maxRequests - used);
  // Requests counted live for each call, as the engine sends them.
  const live = new WeakMap<object, number>();

  const spent = (provider: string): OutboundError =>
    new OutboundError(
      "RateLimited",
      `The run used its budget of ${plural(options.maxRequests, "request")} to ${provider}. Call requestBudget.reset() to start a new run, or raise budget()'s maxRequests.`,
      { limit: "run", provider }
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

      if (
        !perRun &&
        (state.maxRequests === undefined ||
          options.maxRequests < state.maxRequests)
      ) {
        // The engine stops the call once it has made this many requests.
        state.maxRequests = options.maxRequests;
        state.maxRequestsSetBy = "budget()'s maxRequests";
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
