// What an insight costs before it runs, and the request cap it runs under.
// Each insight states its cost once, as arithmetic over a `Price`; the cost is
// worked out twice, once at the least every read can cost and once at the
// most, which gives a lower and an upper bound for this input on this adapter.

import type { OperationCost } from "../internal/adapter.ts";
import type { Capabilities } from "../internal/capabilities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { JsonObject } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { cappedAccess } from "../internal/request-cap.ts";

/**
 * Prices reads on the adapter an insight runs on. Write the insight's cost
 * once with it: it is evaluated at the least and at the most each read and
 * count can be.
 */
export interface Price {
  /** What the instance can do, to price the same branches the insight takes. */
  readonly capabilities: Capabilities;
  /** A listing read up to `max` records: one page at the least, every page and its extras at the most. */
  readonly list: (action: string, max: number) => number;
  /**
   * A listing read to its end, such as a lead's timeline or a thread, priced
   * as one page: a thread longer than a page is not foreseen, and the 25%
   * margin of the default cap absorbs the odd one.
   */
  readonly walk: (action: string) => number;
  /** One lookup, such as `stats` or `campaigns.get`. */
  readonly one: (action: string) => number;
  /** Leads found by an email or a profile, up to `max`: `leads.lookup` where the adapter prices it. */
  readonly lookup: (max: number) => number;
  /**
   * A count only the data decides, up to `max`: 0 at the least, `max` at the
   * most. For example the active campaigns among those read.
   */
  readonly upTo: (max: number) => number;
  /**
   * The campaigns the insight reads, up to `max`: the number actually found
   * once the listing is read, otherwise 0 at the least and `max` at the most.
   */
  readonly campaigns: (max: number) => number;
  /**
   * The campaign listing of `readCampaignsIn` for `statuses` states, up to
   * `max` campaigns: one walk per state where the vendor filters by state.
   */
  readonly campaignsIn: (statuses: number, max: number) => number;
}

/** What a run of the insight costs, as a function of its input. */
export type InsightCost<Input> = (input: Input, price: Price) => number;

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

// Thrown by a price for an action the adapter declares no cost for, which
// makes the whole cost unknown.
const UNKNOWN = Symbol("unknown cost");

// The pages a walk takes to return `records`: one when the listing has no pages.
const pages = (cost: OperationCost, records: number): number =>
  cost.pageSize === undefined
    ? 1
    : Math.max(1, Math.ceil(records / cost.pageSize));

const pricer = (
  outbound: OutboundApi,
  costs: Readonly<Record<string, OperationCost>>,
  most: boolean,
  found: number | undefined
): Price => {
  const of = (action: string): OperationCost => {
    const cost = costs[action];

    if (cost === undefined) {
      throw UNKNOWN;
    }

    return cost;
  };

  const list = (action: string, max: number): number => {
    const cost = of(action);

    return most
      ? pages(cost, max) * (cost.perPageAtMost ?? cost.perPage) +
          max * (cost.perRecord ?? 0) +
          (cost.perWalk ?? 0)
      : cost.perPage;
  };

  const { capabilities } = outbound;

  return {
    campaigns: (max) => {
      if (found !== undefined) {
        return Math.min(found, max);
      }

      return most ? max : 0;
    },
    campaignsIn: (statuses, max) => {
      const cost = of("campaigns.list");
      const filtered = capabilities["campaigns.status"] !== false;

      if (most) {
        // Every state but the last may cost a page of its own.
        return filtered
          ? (statuses - 1) * list("campaigns.list", 1) +
              list("campaigns.list", max)
          : list("campaigns.list", max);
      }

      const read = found === undefined ? 1 : pages(cost, Math.min(found, max));

      return (filtered ? Math.max(statuses, read) : read) * cost.perPage;
    },
    capabilities,
    list,
    lookup: (max) =>
      list(
        costs["leads.lookup"] === undefined ? "leads.list" : "leads.lookup",
        max
      ),
    one: (action) => {
      const cost = of(action);

      return most ? cost.perPage + (cost.perWalk ?? 0) : cost.perPage;
    },
    upTo: (max) => (most ? max : 0),
    walk: (action) => {
      const cost = of(action);

      return list(action, cost.pageSize ?? 1);
    },
  };
};

/**
 * The least and the most this input can cost on this instance, or `null`
 * when the insight states no cost or the adapter declares none for a read it
 * makes, as a combined instance does.
 */
export const boundsOf = <Input>(
  outbound: OutboundApi,
  cost: InsightCost<Input> | undefined,
  input: Input,
  found?: number
): Bounds | null => {
  const costs = cappedAccess(outbound)?.costs;

  if (cost === undefined || costs === undefined) {
    return null;
  }

  try {
    return {
      max: cost(input, pricer(outbound, costs, true, found)),
      min: cost(input, pricer(outbound, costs, false, found)),
    };
  } catch (error) {
    if (error === UNKNOWN) {
      return null;
    }

    throw error;
  }
};

/**
 * The cap an insight runs under when none is set: the most it can cost, a
 * quarter more for retries (each retry is a request too) and 4 on top.
 */
export const defaultCap = (bounds: Bounds | null): number =>
  bounds === null ? Infinity : Math.ceil(bounds.max * 1.25) + 4;

/** The cap a run is under, and where it came from, for the message when it stops. */
export interface CapInEffect {
  readonly cap: number;
  /** `true` when no cap was set and the default applies. */
  readonly isDefault: boolean;
  /** The setting that raises it: `maxRequests` or `maxRequestsPerToolCall`. */
  readonly setting: string;
}

/** What made a run stop at its cap, for the tool result built from the error. */
export interface CapStop extends CapInEffect {
  /** Requests sent before the stop. */
  readonly requests: number;
  /** The input to lower and the value that fits, when one does. */
  readonly lower: Lower | undefined;
}

const stops = new WeakMap<OutboundError, CapStop>();

/** What a cap stop of an insight says, or `undefined` for any other error. */
export const capStopOf = (cause: unknown): CapStop | undefined =>
  OutboundError.is(cause) ? stops.get(cause) : undefined;

export const capWords = (effect: CapInEffect): string =>
  effect.isDefault
    ? `its default cap of ${plural(effect.cap, "request")} for this input`
    : `the cap of ${plural(effect.cap, "request")} (${effect.setting})`;

// A CLI flag such as `--max-requests` takes a whole number, never Infinity.
const removable = (setting: string): string =>
  setting.startsWith("--") ? "" : " (Infinity removes the default)";

/** What to change for a run that stopped at its cap: the input to lower, and the setting to raise. */
export const advice = (stop: CapStop): string => {
  const raise = stop.isDefault
    ? `pass ${stop.setting} to raise it${removable(stop.setting)}`
    : `raise ${stop.setting}`;

  const text =
    stop.lower === undefined
      ? raise
      : `lower ${stop.lower.input} to ${stop.lower.to}${stop.lower.sure ? "" : " or less"}, or ${raise}`;

  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

export const capError = (
  message: string,
  stop: CapStop,
  provider: string
): OutboundError => {
  const error = new OutboundError("RateLimited", `${message} ${advice(stop)}`, {
    limit: "call",
    provider,
  });

  stops.set(error, stop);

  return error;
};

/** The error for a run refused before a request it cannot afford. */
export const refusal = (
  name: string,
  bounds: Bounds,
  room: number,
  stop: CapStop,
  provider: string
): OutboundError => {
  const range = bounds.max > bounds.min ? ` (at most ${bounds.max})` : "";

  const cap = stop.isDefault
    ? `its default cap for this input is ${plural(stop.cap, "request")}`
    : `its cap is ${plural(stop.cap, "request")} (${stop.setting})`;

  const why =
    room < stop.cap
      ? `only ${plural(room, "request")} ${room === 1 ? "is" : "are"} left of the run's budget`
      : cap;

  return capError(
    `${name} needs at least ${plural(bounds.min, "request")} for this input${range}, and ${why}. No request was sent${stop.requests > 0 ? ` after the first ${plural(stop.requests, "request")}` : ""}.`,
    stop,
    provider
  );
};

/** The error for a run that reached its cap part way. */
export const stopped = (
  name: string,
  stop: CapStop,
  provider: string
): OutboundError =>
  capError(
    `${name} stopped after ${plural(stop.requests, "request")}, at ${capWords(stop)}, before it finished; nothing it read is returned.`,
    stop,
    provider
  );

/** An input to lower, and the value to lower it to. */
export interface Lower {
  readonly input: string;
  readonly to: number;
  /** `true` when even the most a run can cost at that value fits; otherwise only its least does. */
  readonly sure: boolean;
}

/**
 * The largest value of `input` under its current one at which a run fits in
 * `room`: where the most it can cost fits, or failing that where its least
 * does. `undefined` when not even one does.
 */
export const fitting = <Input>(
  outbound: OutboundApi,
  cost: InsightCost<Input>,
  input: Input,
  name: string,
  room: number,
  found?: number
): Lower | undefined => {
  // SAFETY: an insight's parsed input is a plain object of JSON values.
  const fields = input as JsonObject;
  const current = fields[name];

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the input to lower is named by the insight, and only a number can be lowered
  if (typeof current !== "number" || current <= 1) {
    return undefined;
  }

  const fits = (value: number, bound: keyof Bounds): boolean => {
    // SAFETY: the same input with one number field changed, which the schema allowed at a higher value.
    const lowered = { ...fields, [name]: value } as Input;
    const bounds = boundsOf(outbound, cost, lowered, found);

    return bounds !== null && bounds[bound] <= room;
  };

  // The largest value from 1 to current - 1 that fits, or 0 when none does.
  const largest = (bound: keyof Bounds): number => {
    let low = 0;
    let high = current - 1;

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);

      if (fits(middle, bound)) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low >= 1 && fits(low, bound) ? low : 0;
  };

  const sure = largest("max");

  if (sure > 0) {
    return { input: name, sure: true, to: sure };
  }

  const maybe = largest("min");

  return maybe > 0 ? { input: name, sure: false, to: maybe } : undefined;
};
