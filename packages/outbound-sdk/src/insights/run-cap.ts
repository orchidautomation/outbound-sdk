// The request cap one insight run is under. Every request of the run, from
// every read in flight, counts against it. A run that cannot afford even the
// least its input costs is refused before its first request, and again once
// its campaign listing says how many campaigns there are.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { requestCounter, withGuard } from "../internal/request-cap.ts";
import type { RequestCounter } from "../internal/request-cap.ts";
import { boundsOf, defaultCap, fitting, refusal, stopped } from "./cost.ts";
import type { CapInEffect, CapStop, InsightCost } from "./cost.ts";

export interface CapOptions {
  /**
   * The most vendor requests the whole insight may send, retries included,
   * across every read it makes. Replaces the default cap, which is worked
   * out from the input; `Infinity` removes it. A `maxRequestsPerCall` on the
   * instance and `budget()` still apply under it.
   */
  readonly maxRequests?: number | undefined;
  /**
   * Set by the insight tools: the default cap is at most this much, and the
   * messages name `capSetting`. Not for direct use.
   */
  readonly capCeiling?: number | undefined;
  /** The setting a cap message tells the caller to raise. Not for direct use. */
  readonly capSetting?: string | undefined;
}

/** What of an insight the cap needs. */
export interface Capped<Input> {
  readonly name: string;
  readonly cost?: InsightCost<Input> | undefined;
  readonly scales?: string | undefined;
}

export interface RunCap {
  /** The instance to read through: every request on it is counted. */
  readonly outbound: OutboundApi;
  /** Refuses the run when the least `count` campaigns cost is over what it may spend. */
  readonly campaignsFound: (count: number) => void;
  /** Throws the cap's own error when the cap stopped a read, else `error`. */
  readonly failed: (cause: unknown) => never;
  /** The note for a run that finished without reads the cap stopped. */
  readonly shortNote: () => string | undefined;
}

/** The cap this run is under: the one set, or the default for this input. */
const capFor = (
  outbound: OutboundApi,
  name: string,
  max: number,
  options: CapOptions
): CapInEffect => {
  const set = options.maxRequests;

  if (
    set !== undefined &&
    set !== Infinity &&
    (!Number.isInteger(set) || set < 1)
  ) {
    throw new OutboundError(
      "Invalid",
      `${name}: maxRequests must be a positive integer, or Infinity for no default cap`,
      { provider: outbound.provider }
    );
  }

  const setting = options.capSetting ?? "maxRequests";

  return set === undefined
    ? {
        cap: Math.min(max, options.capCeiling ?? Infinity),
        isDefault: true,
        setting,
      }
    : { cap: set, isDefault: false, setting };
};

interface WithRunBudget {
  readonly requestBudget: {
    readonly per?: "call" | "run";
    readonly remaining: () => number;
  };
}

const hasRunBudget = (
  outbound: OutboundApi
): outbound is OutboundApi & WithRunBudget => "requestBudget" in outbound;

// What a `budget({ per: "run" })` has left caps the insight too.
const runBudgetLeft = (outbound: OutboundApi): number =>
  hasRunBudget(outbound) && outbound.requestBudget.per === "run"
    ? outbound.requestBudget.remaining()
    : Infinity;

export const runCap = <Input>(
  outbound: OutboundApi,
  spec: Capped<Input>,
  input: Input,
  options: CapOptions
): RunCap => {
  const bounds = boundsOf(outbound, spec.cost, input);
  const effect = capFor(outbound, spec.name, defaultCap(bounds), options);

  const stop = (room: number, found?: number): CapStop => ({
    ...effect,
    lower:
      spec.cost === undefined || spec.scales === undefined
        ? undefined
        : fitting(outbound, spec.cost, input, spec.scales, room, found),
    requests: counter.used(),
  });

  // Counts every request of the run, and stops at the cap when there is one.
  const counter: RequestCounter = requestCounter(effect.cap, (provider) =>
    stopped(spec.name, stop(effect.cap), provider)
  );

  const check = (found?: number): void => {
    // A run budget has already counted what this run spent; the least is a total.
    const room = Math.min(effect.cap, counter.used() + runBudgetLeft(outbound));

    const least = boundsOf(outbound, spec.cost, input, found);

    if (least !== null && least.min > room) {
      throw refusal(
        spec.name,
        least,
        room,
        stop(room, found),
        outbound.provider
      );
    }
  };

  check();

  const isStopped = (): boolean => counter.stopped();

  return {
    campaignsFound: check,
    failed: (cause) => {
      // A read stopped at the cap may surface re-wrapped, or as another
      // read's failure: the counter, not the error, says the cap was reached.
      throw isStopped()
        ? stopped(spec.name, stop(effect.cap), outbound.provider)
        : cause;
    },
    outbound: withGuard(outbound, counter),
    shortNote: () =>
      isStopped()
        ? `Reads past ${counter.used()} requests were stopped at ${effect.isDefault ? "the default cap for this input" : `the cap (${effect.setting})`}; the answer leaves them out.`
        : undefined,
  };
};
