// What the copy insights share: the base a step's rate is divided by, and a
// rate with its interval.

import { z } from "zod";

import type { MetricRow } from "../../internal/entities.ts";
import { sumCounts } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { rate, wilson } from "../stats.ts";
import type { Interval } from "../stats.ts";

/** A `YYYY-MM-DD` input that defaults to `null`, meaning no bound. */
export const dayInput = (description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "must be YYYY-MM-DD")
    .nullable()
    .default(null)
    .describe(description);

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

export interface Measured {
  readonly count: number | null;
  readonly trials: number | null;
  readonly basis: RateBasis | null;
  readonly rate: number | null;
  /** The 95% Wilson interval of the rate. `null` when the rate is unknown. */
  readonly interval: Interval | null;
}

export const measure = (count: number | null, base: Base): Measured => ({
  basis: base.basis,
  count,
  interval: wilson(count, base.trials),
  rate: rate(count, base.trials),
  trials: base.trials,
});

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
