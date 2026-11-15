// A request cap across many SDK calls. An insight or one tool call reads
// through a copy of the instance whose every request counts against one
// allowance, even when reads run side by side. The engine's `maxRequests`
// caps a single SDK call; this caps the whole answer.

import type { OperationCost } from "./adapter.ts";
import type { OutboundApi } from "./outbound/api.ts";
import type { OutboundPlugin } from "./outbound/plugins.ts";

// A registered symbol, so a copy of the package bundled into another entry
// point still finds it on the instance.
export const CAPPED = Symbol.for("outbound-sdk.capped");

/** Counts requests as they are sent, and stops one that would pass the cap. */
export interface RequestGuard {
  /** Throws when no request is left. Runs before the request is sent. */
  readonly check: (provider: string) => void;
  /** Counts the request being sent. */
  readonly count: () => void;
}

export interface CappedAccess {
  /** What the adapter's reads cost, or `undefined` when it declares none. */
  readonly costs: Readonly<Record<string, OperationCost>> | undefined;
  /** The same instance with `layer` innermost, kept out of `plugins`. */
  readonly guarded: (layer: OutboundPlugin) => OutboundApi;
}

interface Cappable {
  readonly [CAPPED]: CappedAccess;
}

const isCappable = (
  outbound: OutboundApi
): outbound is OutboundApi & Cappable => CAPPED in outbound;

/** What an instance built by `createOutbound` offers for a shared cap; `undefined` on anything else. */
export const cappedAccess = (outbound: OutboundApi): CappedAccess | undefined =>
  isCappable(outbound) ? outbound[CAPPED] : undefined;

export interface RequestCounter extends RequestGuard {
  /** Requests counted so far. */
  readonly used: () => number;
  /** `true` once a request was stopped at the cap. */
  readonly stopped: () => boolean;
}

/**
 * Allows `cap` requests in all. `stop` builds the error for the request that
 * would pass it. `Infinity` counts without stopping.
 */
export const requestCounter = (
  cap: number,
  stop: (provider: string) => Error
): RequestCounter => {
  let used = 0;
  let stopped = false;

  return {
    check: (provider) => {
      if (used >= cap) {
        stopped = true;

        throw stop(provider);
      }
    },
    count: () => {
      used += 1;
    },
    stopped: () => stopped,
    used: () => used,
  };
};

// Counts each request of a call against the guard, innermost, so a cap
// shared across calls sees every request the engine is about to send.
const guarding = (guard: RequestGuard): OutboundPlugin => {
  const seen = new WeakSet<object>();

  return {
    name: "request cap",
    wrap: (operation, next, info) => {
      const { state } = info;

      if (!seen.has(state)) {
        seen.add(state);
        const prior = state.beforeRequest;

        state.beforeRequest = () => {
          guard.check(info.provider);
          prior?.();
          guard.count();
        };
      }

      return next(operation);
    },
  };
};

/**
 * `outbound` with every request counted by `guard`. An instance not built by
 * `createOutbound` is returned as it is: there is nothing to count through.
 */
export const withGuard = <Api extends OutboundApi>(
  outbound: Api,
  guard: RequestGuard
): Api => {
  const access = cappedAccess(outbound);

  // SAFETY: the copy is built from the same class, options and plugins, so it has everything they add.
  return access === undefined
    ? outbound
    : (access.guarded(guarding(guard)) as Api);
};
