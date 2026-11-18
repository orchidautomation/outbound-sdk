// variant_test: whether a step's A/B leader is ahead by more than chance.

import { z } from "zod";

import type { MetricRow } from "../../internal/entities.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { refOf } from "../ref.ts";
import { compareRates, percent } from "../stats.ts";
import { stepAt } from "../step.ts";
import type { StepPosition } from "../step.ts";
import {
  basesInWords,
  measure,
  rangeOf,
  sharedBases,
  splitStats,
} from "./shared.ts";
import type { Base, Measured, RateBasis } from "./shared.ts";

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
    .describe(
      "The campaign's ref, for example `instantly:acme:abc123`, or its name"
    ),
  ...rangeFields,
  metric: z
    .enum(METRICS)
    .default("replied")
    .describe(
      "What variants are judged on. Replies divide by leads contacted, opens and clicks by messages delivered, else by sends."
    ),
  min_sent: z
    .number()
    .int()
    .min(1)
    .default(100)
    .describe(
      "Smallest base (sends, or leads contacted when counted) a variant needs to be compared."
    ),
});

export type VariantVerdict = "no_difference_yet" | "too_little_data" | "winner";

export interface TestedVariant {
  readonly variantKey: string;
  readonly sent: number | null;
  /** The metric's count. `null` when the vendor does not report it. */
  readonly count: number | null;
  /** What the rate is divided by. */
  readonly of: number | null;
  /** What `of` counts. The same for every variant of a step unless they report no base in common, and then the step is not compared. */
  readonly basis: RateBasis | null;
  readonly rate: number | null;
  /** The 95% Wilson interval of the rate. `null` when the rate is unknown. */
  readonly low: number | null;
  readonly high: number | null;
  /** `false` when the base is under `min_sent` or the rate is unknown; such a variant is not compared. */
  readonly enoughData: boolean;
  /** Two-sided p-value against the leader. `null` for the leader, a variant not compared, and two rates that are both 0 or both 1. */
  readonly pValueVsLeader: number | null;
}

export interface VariantStepTest extends StepPosition {
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
  /**
   * `false` when the vendor's step stats carry no variant rows at all, and
   * `null` when it reported no step stats in the date range, which cannot
   * tell either way.
   */
  readonly variantStatsReported: boolean | null;
  /**
   * The answer in one sentence, including why nothing was compared: no step
   * stats, no variant rows, or no step with two variants.
   */
  readonly finding: string;
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
  base: Base,
  minSent: number,
  metric: Metric
): Candidate => {
  const measured = measure(counts[metric], base);

  return {
    ...measured,
    enoughData:
      measured.rate !== null && measured.of !== null && measured.of >= minSent,
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
    (sum, each) => sum + Math.max(0, minSent - (each.of ?? 0)),
    0
  );
};

interface Settings {
  readonly metric: Metric;
  readonly minSent: number;
  readonly alpha: number;
}

const reasonFor = (
  candidates: readonly Candidate[],
  settings: Settings,
  comparable: boolean
): string => {
  if (!comparable) {
    return `The variants of this step report different bases (${basesInWords(
      candidates.map((each) => ({ basis: each.basis, name: each.variantKey }))
    )}), so their rates cannot be compared.`;
  }

  return candidates.some((each) => each.count === null)
    ? `The vendor does not report ${settings.metric} for every variant of this step, so they cannot be compared.`
    : `Fewer than two variants have a base of ${settings.minSent}, so no comparison is made.`;
};

const tooLittle = (
  step: number,
  candidates: readonly Candidate[],
  settings: Settings,
  comparable: boolean
): VariantStepTest => ({
  leader: null,
  // More sends do not give variants with different bases a common one.
  moreSendsNeeded: comparable ? shortfall(candidates, settings.minSent) : null,
  pValue: null,
  reason: reasonFor(candidates, settings, comparable),
  ...stepAt(step),
  variants: candidates.map((each) => ({ ...each, pValueVsLeader: null })),
  verdict: "too_little_data",
});

const testStep = (
  step: number,
  candidates: readonly Candidate[],
  settings: Settings,
  comparable: boolean
): VariantStepTest => {
  if (!comparable) {
    return tooLittle(step, candidates, settings, false);
  }

  const ready = candidates
    .filter((each) => each.enoughData)
    .toSorted(
      (left, right) =>
        (right.rate ?? 0) - (left.rate ?? 0) || (right.of ?? 0) - (left.of ?? 0)
    );

  const [leader, rival] = ready;

  if (leader === undefined || rival === undefined) {
    return tooLittle(step, candidates, settings, true);
  }

  const tests = new Map(
    ready
      .slice(1)
      .map((other) => [
        other.variantKey,
        compareRates(
          { successes: leader.count, trials: leader.of },
          { successes: other.count, trials: other.of },
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
      : ` ${plural(skipped, "variant")} with too little data ${noun(skipped, "was", "were")} left out.`;

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
      ...stepAt(step),
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
            (leader.of ?? 0) + (rival.of ?? 0),
            settings.alpha
          ),
    pValue: closest?.pValue ?? null,
    reason: `Variant ${leader.variantKey} (${percent(leader.rate)}) leads variant ${rival.variantKey} (${percent(rival.rate)}), but a gap this size could be chance.${aside}`,
    ...stepAt(step),
    variants,
    verdict: "no_difference_yet",
  };
};

/** Tests one step's variants, each divided by the base they all report. */
const stepTest = (
  step: number,
  variants: ReadonlyMap<string, MetricCounts>,
  settings: Settings
): VariantStepTest => {
  const entries = [...variants];

  const { bases, comparable } = sharedBases(
    entries.map(([, counts]) => counts),
    settings.metric === "replied" || settings.metric === "positive"
      ? "lead"
      : "message"
  );

  const candidates = entries.map(([key, counts], index) =>
    candidateOf(
      key,
      counts,
      bases[index] ?? { basis: null, trials: null },
      settings.minSent,
      settings.metric
    )
  );

  return testStep(step, candidates, settings, comparable);
};

/** Whether the vendor splits step stats by variant, with a note when it does not or cannot tell. */
const variantsReported = (
  context: InsightContext,
  rows: readonly MetricRow[]
): boolean | null => {
  if (rows.length === 0) {
    context.note(
      "The vendor reported no step stats for this campaign in the date range, so there is nothing to compare."
    );

    return null;
  }

  const reported = rows.some((row) => row.variantKey !== null);

  if (!reported) {
    context.note(
      "The step stats carry no variant rows, so there is nothing to compare."
    );
  }

  return reported;
};

const findingOf = (
  reported: boolean | null,
  totals: VariantTest["totals"]
): string => {
  if (reported === null) {
    return "No step stats in this date range, so there is nothing to compare.";
  }

  if (!reported) {
    return "The vendor does not report results by variant for this campaign, so there is nothing to compare.";
  }

  return totals.stepsTested === 0
    ? "No step has two variants to compare: every step with stats has one variant."
    : `${plural(totals.winners, "step")} with a real winner out of ${totals.stepsTested} tested.`;
};

const countOf = (
  steps: readonly VariantStepTest[],
  verdict: VariantVerdict
): number => steps.filter((step) => step.verdict === verdict).length;

export const variantTest = defineInsight({
  description:
    "Whether a campaign's A/B winner is real. For each step with two or more variants, tests every variant against the leader by a two-proportion test and returns the rates with 95% intervals, the leader and a verdict: winner, no_difference_yet or too_little_data, with the p-value and a rough number of sends still needed. Use it before pausing a variant. Costs 1 request. A null count or rate is not reported, never 0.",
  inputSchema: input,
  key: "variantTest",
  cost: (_input, price) => price.one("stats"),
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
          : [stepTest(step, stats.variants, settings)]
      )
      .toSorted(
        (left, right) =>
          ORDER[left.verdict] - ORDER[right.verdict] ||
          left.stepIndex - right.stepIndex
      );

    const reported = variantsReported(context, rows);

    const totals = {
      noDifferenceYet: countOf(steps, "no_difference_yet"),
      stepsTested: steps.length,
      tooLittleData: countOf(steps, "too_little_data"),
      winners: countOf(steps, "winner"),
    };

    const result: VariantTest = {
      alpha,
      campaign: refOf(context.outbound, campaign),
      finding: findingOf(reported, totals),
      metric,
      steps,
      totals,
      variantStatsReported: reported,
    };

    return result;
  },
});
