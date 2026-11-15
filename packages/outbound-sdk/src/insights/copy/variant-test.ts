// variant_test: whether a step's A/B leader is ahead by more than chance.

import { z } from "zod";

import type { MetricCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import { compareRates, percent } from "../stats.ts";
import type { Interval } from "../stats.ts";
import {
  dayInput,
  measure,
  perLead,
  perMessage,
  rangeOf,
  splitStats,
} from "./shared.ts";
import type { Measured, RateBasis } from "./shared.ts";

const METRICS = ["replied", "positive", "opened", "clicked"] as const;

type Metric = (typeof METRICS)[number];

const input = z.object({
  alpha: z
    .number()
    .gt(0)
    .max(0.5)
    .default(0.05)
    .describe(
      "The chance of calling a winner that is not one. A difference with a p-value under this is a winner."
    ),
  campaign: z
    .string()
    .min(1)
    .describe("The campaign's ref, for example `instantly:acme:abc123`"),
  from: dayInput("First day to count, YYYY-MM-DD. null counts from the start."),
  metric: z
    .enum(METRICS)
    .default("replied")
    .describe(
      "What a variant is judged on. Replies and positive replies are divided by leads contacted (or sends); opens and clicks by messages delivered (or sends)."
    ),
  min_sent: z
    .number()
    .int()
    .min(1)
    .default(100)
    .describe(
      "A variant with a smaller base than this (sends, or leads contacted when the vendor counts those) is not compared."
    ),
  to: dayInput("Last day to count, YYYY-MM-DD. null counts to today."),
});

export type VariantVerdict = "no_difference_yet" | "too_little_data" | "winner";

export interface TestedVariant {
  readonly variantKey: string;
  readonly sent: number | null;
  /** The metric's count. `null` when the vendor does not report it. */
  readonly count: number | null;
  /** What the rate is divided by. */
  readonly trials: number | null;
  readonly basis: RateBasis | null;
  readonly rate: number | null;
  readonly interval: Interval | null;
  /** `false` when the base is under `min_sent` or the rate is unknown; such a variant is not compared. */
  readonly enoughData: boolean;
  /** Two-sided p-value against the leader. `null` for the leader, a variant not compared, and two rates that are both 0 or both 1. */
  readonly pValueVsLeader: number | null;
}

export interface VariantStepTest {
  /** Counted from 0. */
  readonly step: number;
  readonly verdict: VariantVerdict;
  /** The variant with the highest rate among those with enough data. `null` when fewer than two have enough. */
  readonly leader: string | null;
  /** The p-value of the leader against its closest rival. */
  readonly pValue: number | null;
  /** A rough number of further sends, over all variants, before there can be a verdict. `null` when it cannot be estimated or there is a winner. */
  readonly moreSendsNeeded: number | null;
  readonly reason: string;
  readonly variants: readonly TestedVariant[];
}

export interface VariantTest {
  readonly campaign: string;
  readonly metric: Metric;
  readonly alpha: number;
  /** `false` when the vendor's step stats carry no variant rows at all. */
  readonly variantStatsReported: boolean;
  /** Winners first, then steps with no difference yet, then steps with too little data. */
  readonly steps: readonly VariantStepTest[];
  readonly totals: {
    readonly stepsTested: number;
    readonly winners: number;
    readonly noDifferenceYet: number;
    readonly tooLittleData: number;
  };
}

const ORDER: Readonly<Record<VariantVerdict, number>> = {
  no_difference_yet: 1,
  too_little_data: 2,
  winner: 0,
};

// Abramowitz and Stegun 26.2.23: the normal quantile to about 4.5e-4.
const quantile = (tail: number): number => {
  const t = Math.sqrt(-2 * Math.log(tail));

  return (
    t -
    (2.515517 + 0.802853 * t + 0.010328 * t ** 2) /
      (1 + 1.432788 * t + 0.189269 * t ** 2 + 0.001308 * t ** 3)
  );
};

/**
 * If both rates stay as they are, the z-score grows with the square root of
 * the sample, so the sample must grow by (critical z / z) squared.
 */
const sendsToSignificance = (
  score: number,
  trials: number,
  alpha: number
): number | null =>
  score === 0
    ? null
    : Math.max(0, Math.ceil(((quantile(alpha / 2) / score) ** 2 - 1) * trials));

interface Candidate extends Measured {
  readonly variantKey: string;
  readonly sent: number | null;
  readonly enoughData: boolean;
}

const candidateOf = (
  variantKey: string,
  counts: MetricCounts,
  metric: Metric,
  minSent: number
): Candidate => {
  const base =
    metric === "replied" || metric === "positive"
      ? perLead(counts)
      : perMessage(counts);

  const measured = measure(counts[metric], base);

  return {
    ...measured,
    enoughData:
      measured.rate !== null &&
      measured.trials !== null &&
      measured.trials >= minSent,
    sent: counts.sent,
    variantKey,
  };
};

const shortfall = (
  candidates: readonly Candidate[],
  minSent: number
): number | null => {
  // A variant whose count the vendor does not report is not helped by more sends.
  if (candidates.some((each) => each.count === null)) {
    return null;
  }

  return candidates.reduce(
    (sum, each) => sum + Math.max(0, minSent - (each.trials ?? 0)),
    0
  );
};

interface Settings {
  readonly metric: Metric;
  readonly minSent: number;
  readonly alpha: number;
}

const tooLittle = (
  step: number,
  candidates: readonly Candidate[],
  settings: Settings
): VariantStepTest => {
  const unreported = candidates.some((each) => each.count === null);

  return {
    leader: null,
    moreSendsNeeded: shortfall(candidates, settings.minSent),
    pValue: null,
    reason: unreported
      ? `The vendor does not report ${settings.metric} for every variant of this step, so they cannot be compared.`
      : `Fewer than two variants have a base of ${settings.minSent}, so no comparison is made.`,
    step,
    variants: candidates.map((each) => ({ ...each, pValueVsLeader: null })),
    verdict: "too_little_data",
  };
};

const testStep = (
  step: number,
  candidates: readonly Candidate[],
  settings: Settings
): VariantStepTest => {
  const ready = candidates
    .filter((each) => each.enoughData)
    .toSorted(
      (left, right) =>
        (right.rate ?? 0) - (left.rate ?? 0) ||
        (right.trials ?? 0) - (left.trials ?? 0)
    );

  const [leader, rival] = ready;

  if (leader === undefined || rival === undefined) {
    return tooLittle(step, candidates, settings);
  }

  const tests = new Map(
    ready
      .slice(1)
      .map((other) => [
        other.variantKey,
        compareRates(
          { successes: leader.count, trials: leader.trials },
          { successes: other.count, trials: other.trials },
          settings.alpha
        ),
      ])
  );

  const closest = tests.get(rival.variantKey) ?? null;
  const beatsAll = [...tests.values()].every((test) => test?.significant);
  const skipped = candidates.length - ready.length;

  const aside =
    skipped === 0
      ? ""
      : ` ${skipped} variant(s) with too little data were left out.`;

  const variants = candidates.map((each) => ({
    ...each,
    pValueVsLeader: tests.get(each.variantKey)?.pValue ?? null,
  }));

  if (beatsAll) {
    return {
      leader: leader.variantKey,
      moreSendsNeeded: null,
      pValue: closest?.pValue ?? null,
      reason: `Variant ${leader.variantKey} (${percent(leader.rate)}) beats every other variant by more than chance at alpha ${settings.alpha}.${aside}`,
      step,
      variants,
      verdict: "winner",
    };
  }

  return {
    leader: leader.variantKey,
    moreSendsNeeded:
      closest === null
        ? null
        : sendsToSignificance(
            closest.z,
            (leader.trials ?? 0) + (rival.trials ?? 0),
            settings.alpha
          ),
    pValue: closest?.pValue ?? null,
    reason: `Variant ${leader.variantKey} (${percent(leader.rate)}) leads variant ${rival.variantKey} (${percent(rival.rate)}), but a gap this size could be chance.${aside}`,
    step,
    variants,
    verdict: "no_difference_yet",
  };
};

const countOf = (
  steps: readonly VariantStepTest[],
  verdict: VariantVerdict
): number => steps.filter((step) => step.verdict === verdict).length;

export const variantTest = defineInsight({
  description:
    "Whether a campaign's A/B winner is real. For each step with two or more variants, compares every variant with the leader by a two-proportion test and returns the variants with rates and 95% intervals, the leader, and a verdict: winner, no_difference_yet or too_little_data, with the p-value and a rough number of sends still needed when there is no verdict. Use it before pausing a variant. Costs 1 request. A null count or rate means the vendor does not report it; an empty list means the vendor does not split step stats by variant.",
  inputSchema: input,
  key: "variantTest",
  name: "variant_test",
  needs: ["stats.byStep"],
  next: "Use step_funnel to see how much of the campaign's replies the tested step brings, or copy_audit to check the losing variant's copy.",
  run: async (context, { alpha, campaign, from, metric, min_sent, to }) => {
    const rows = context.rows(
      await context.outbound
        .campaign(campaign)
        .stats({ ...rangeOf(from, to), scope: "step" })
    );

    const split = splitStats(rows);
    const settings: Settings = { alpha, metric, minSent: min_sent };

    const steps = [...split.steps]
      .flatMap(([step, stats]) =>
        stats.variants.size < 2
          ? []
          : [
              testStep(
                step,
                [...stats.variants].map(([key, counts]) =>
                  candidateOf(key, counts, metric, min_sent)
                ),
                settings
              ),
            ]
      )
      .toSorted(
        (left, right) =>
          ORDER[left.verdict] - ORDER[right.verdict] || left.step - right.step
      );

    const reported = rows.some((row) => row.variantKey !== null);

    if (!reported) {
      context.note(
        "The step stats carry no variant rows, so there is nothing to compare."
      );
    }

    const result: VariantTest = {
      alpha,
      campaign,
      metric,
      steps,
      totals: {
        noDifferenceYet: countOf(steps, "no_difference_yet"),
        stepsTested: steps.length,
        tooLittleData: countOf(steps, "too_little_data"),
        winners: countOf(steps, "winner"),
      },
      variantStatsReported: reported,
    };

    return result;
  },
});
