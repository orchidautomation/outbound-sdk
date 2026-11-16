// What the copy insights share: the base a step's rate is divided by, and a
// rate with its interval.

import type { MetricRow } from "../../internal/entities.ts";
import { sumCounts } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import type { Measured as Rate } from "../ops/shared.ts";
import { rate, wilson } from "../stats.ts";

export interface DayRange {
  readonly from: string | undefined;
  readonly to: string | undefined;
}

export const rangeOf = (from: string | null, to: string | null): DayRange => ({
  from: from ?? undefined,
  to: to ?? undefined,
});

export type RateBasis = "contacted" | "delivered" | "sent";

export interface Base {
  /** What the rate is divided by. `null` when the vendor reports no base. */
  readonly trials: number | null;
  readonly basis: RateBasis | null;
}

const firstKnown = (
  candidates: readonly (readonly [RateBasis, number | null])[]
): Base => {
  for (const [basis, value] of candidates) {
    if (value !== null && value > 0) {
      return { basis, trials: value };
    }
  }

  return { basis: null, trials: null };
};

/** Replies are counted per lead contacted, or per message sent when the vendor reports no leads. */
export const perLead = (counts: MetricCounts): Base =>
  firstKnown([
    ["contacted", counts.contacted],
    ["sent", counts.sent],
  ]);

/** Opens and clicks are counted per message delivered, or per message sent. */
export const perMessage = (counts: MetricCounts): Base =>
  firstKnown([
    ["delivered", counts.delivered],
    ["sent", counts.sent],
  ]);

/** The counts' base of one kind, or no base when they do not report it. */
export const baseIn = (counts: MetricCounts, basis: RateBasis): Base =>
  firstKnown([[basis, counts[basis]]]);

const ORDER = {
  lead: ["contacted", "sent"],
  message: ["delivered", "sent"],
} as const satisfies Record<string, readonly RateBasis[]>;

export interface SharedBases {
  /** One base per entry of counts, in order. */
  readonly bases: readonly Base[];
  /** The base every entry is divided by. `null` when they are not comparable or none reports a base. */
  readonly basis: RateBasis | null;
  /** `false` when no one base is reported by every entry, so each has its own and they cannot be compared. */
  readonly comparable: boolean;
}

/**
 * One base for counts that are compared with each other: the first in the
 * usual order that every entry with a base reports. One variant divided by
 * leads contacted and another by messages sent would differ for no reason
 * but the base.
 */
export const sharedBases = (
  counts: readonly MetricCounts[],
  per: keyof typeof ORDER
): SharedBases => {
  const own = counts.map(per === "lead" ? perLead : perMessage);
  const based = counts.filter((_, index) => own[index]?.basis !== null);

  for (const basis of ORDER[per]) {
    if (based.every((each) => (each[basis] ?? 0) > 0)) {
      return {
        bases: counts.map((each) => baseIn(each, basis)),
        basis: based.length === 0 ? null : basis,
        comparable: true,
      };
    }
  }

  return { bases: own, basis: null, comparable: false };
};

const BASIS_WORDS: Readonly<Record<RateBasis, string>> = {
  contacted: "per lead contacted",
  delivered: "per message delivered",
  sent: "per message sent",
};

/** `A per lead contacted, B per message sent`, for a note that bases differ. */
export const basesInWords = (
  named: readonly { readonly name: string; readonly basis: RateBasis | null }[]
): string =>
  named
    .map(
      ({ basis, name }) =>
        `${name} ${basis === null ? "with no base" : BASIS_WORDS[basis]}`
    )
    .join(", ");

/** A rate with its counts and 95% Wilson interval, and what it divides by. */
export interface BasedRate extends Rate {
  /** What `of` counts. */
  readonly basis: RateBasis | null;
}

/** A measured rate. */
export type Measured = BasedRate;

export const measure = (count: number | null, base: Base): Measured => {
  const interval = wilson(count, base.trials);

  return {
    basis: base.basis,
    count,
    high: interval?.high ?? null,
    low: interval?.low ?? null,
    of: base.trials,
    rate: rate(count, base.trials),
  };
};

const NO_RATE: BasedRate = {
  basis: null,
  count: null,
  high: null,
  low: null,
  of: null,
  rate: null,
};

/** The rate alone, without any field a caller added beside it. */
export const replyRateOf = (measured: Measured | null): BasedRate =>
  measured === null
    ? NO_RATE
    : {
        basis: measured.basis,
        count: measured.count,
        high: measured.high,
        low: measured.low,
        of: measured.of,
        rate: measured.rate,
      };

/** Adds rows of counts; a count no row reports stays `null`. */
export const sumRows = (rows: readonly MetricRow[]): MetricCounts =>
  sumCounts(rows);

/** Groups values by a key, in first-seen order. */
export const groupBy = <Value, Key>(
  values: readonly Value[],
  keyOf: (value: Value) => Key
): Map<Key, Value[]> => {
  const groups = new Map<Key, Value[]>();

  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [value]);
    } else {
      group.push(value);
    }
  }

  return groups;
};

export interface StepStats {
  /** The step's own total: its step-level rows, or its variant rows added up. */
  readonly total: MetricCounts | null;
  /** Counts per variant key, when the vendor splits the step by variant. */
  readonly variants: ReadonlyMap<string, MetricCounts>;
}

export interface SplitStats {
  readonly steps: ReadonlyMap<number, StepStats>;
  /** Rows the vendor tied to no step. */
  readonly unattributed: readonly MetricRow[];
}

const stepStats = (rows: readonly MetricRow[]): StepStats => {
  const whole = rows.filter((row) => row.variantKey === null);

  const variants = new Map(
    [...groupBy(rows, (row) => row.variantKey)].flatMap(([key, group]) =>
      key === null ? [] : [[key, sumRows(group)] as const]
    )
  );

  return {
    total: sumRows(whole.length > 0 ? whole : rows),
    variants,
  };
};

/** Sorts step stats rows into steps and their variants. */
export const splitStats = (rows: readonly MetricRow[]): SplitStats => {
  const byStep = groupBy(rows, (row) => row.stepIndex);

  const steps = new Map(
    [...byStep].flatMap(([index, group]) =>
      index === null ? [] : [[index, stepStats(group)] as const]
    )
  );

  return { steps, unattributed: byStep.get(null) ?? [] };
};
