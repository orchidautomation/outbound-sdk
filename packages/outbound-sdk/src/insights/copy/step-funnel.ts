// step_funnel: which step of a sequence the replies come from.

import { z } from "zod";

import type { MetricRow, Sequence } from "../../internal/entities.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { refOf } from "../ref.ts";
import { rate, total } from "../stats.ts";
import { stepAt, stepLabel } from "../step.ts";
import type { StepPosition } from "../step.ts";
import {
  groupBy,
  measure,
  perLead,
  rangeOf,
  replyRateOf,
  splitStats,
  sumRows,
} from "./shared.ts";
import type { BasedRate, StepStats } from "./shared.ts";

/** Below this many replies a step's rate is too uncertain to call it reliably above the bar. */
export const MIN_REPLIES = 5;

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe(
      "The campaign's ref, for example `instantly:acme:abc123`, or its name"
    ),
  ...rangeFields,
  by_day: z
    .boolean()
    .default(false)
    .describe("Per-day step counts (stats.byStepDay)"),
  min_reply_rate: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      `The bar the low end of a step's reply rate interval must clear, with ${MIN_REPLIES} or more replies. 0 means above zero.`
    ),
});

export interface FunnelVariant {
  readonly variantKey: string;
  /** The hash of the variant's current copy. `null` when the sequence no longer has the variant. */
  readonly contentHash: string | null;
  readonly sent: number | null;
  readonly replies: number | null;
  readonly rates: { readonly replyRate: BasedRate };
}

export interface FunnelStep extends StepPosition {
  /** `null` when the stats name a step the sequence no longer has. */
  readonly action: string | null;
  readonly delayDays: number | null;
  readonly inSequence: boolean;
  readonly sent: number | null;
  readonly replies: number | null;
  /** Replies divided by leads contacted, or messages sent, as `basis` says. */
  readonly rates: { readonly replyRate: BasedRate };
  /** This step's replies divided by every reply in the campaign, unattributed ones included. */
  readonly shareOfReplies: number | null;
  /** Sends of the step before minus this step's sends. `null` for the first step or an unknown count. */
  readonly sentDrop: number | null;
  /** `sentDrop` divided by the sends of the step before. */
  readonly sentDropRate: number | null;
  /**
   * `true` when the low end of the reply rate interval is above
   * `min_reply_rate` and the step has at least `MIN_REPLIES` (5) replies;
   * `false` when the low end is at or under it. `null` when the rate is
   * unknown, or it is above the bar on too few replies to tell.
   */
  readonly earnsPlace: boolean | null;
  /** Empty when the vendor does not split step stats by variant. */
  readonly variants: readonly FunnelVariant[];
}

/** One step's counts on one day. */
export interface FunnelDayStep {
  /** Counted from 0. */
  readonly stepIndex: number;
  /** Counted from 1, as a person counts. */
  readonly stepNumber: number;
  readonly sent: number | null;
  readonly replies: number | null;
}

/** The funnel of one day: what each step sent and got back that day. */
export interface FunnelDay {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Oldest step first. A step with no row that day is left out, never shown as 0. */
  readonly steps: readonly FunnelDayStep[];
}

export interface StepFunnel {
  readonly campaign: string;
  /** Each day's funnel, oldest first, when `by_day` asked for it. `null` otherwise. */
  readonly days: readonly FunnelDay[] | null;
  /** What the numbers say, in one or two sentences. */
  readonly finding: string;
  /** The step with the most replies, counted from 0. `null` when no step has a reply. */
  readonly topStepIndex: number | null;
  /** `topStepIndex` counted from 1, as a person counts. */
  readonly topStepNumber: number | null;
  /** @deprecated Use `topStepIndex` (the same value, counted from 0) or `topStepNumber`. Removed in 0.15.0. */
  readonly topStep: number | null;
  /** The last step that earns its place (see `earnsPlace`), counted from 0. `null` when none does. */
  readonly lastStepEarningPlaceIndex: number | null;
  /** `lastStepEarningPlaceIndex` counted from 1, as a person counts. */
  readonly lastStepEarningPlaceNumber: number | null;
  /** @deprecated Use `lastStepEarningPlaceIndex` (the same value, counted from 0) or `lastStepEarningPlaceNumber`. Removed in 0.15.0. */
  readonly lastStepEarningPlace: number | null;
  readonly steps: readonly FunnelStep[];
  readonly totals: {
    readonly sent: number | null;
    readonly replies: number | null;
  };
  /** Counts the vendor tied to no step. They are in no step's row. */
  readonly unattributed: {
    readonly rows: number;
    readonly sent: number | null;
    readonly replies: number | null;
  };
}

type Draft = Omit<
  FunnelStep,
  "sentDrop" | "sentDropRate" | "shareOfReplies"
> & { readonly parent: number | null };

const variantsOf = (
  stats: StepStats | undefined,
  step: Sequence["steps"][number] | undefined
): FunnelVariant[] =>
  [...(stats?.variants ?? [])].map(([variantKey, counts]) => {
    const measured = measure(counts.replied, perLead(counts));

    return {
      contentHash:
        step?.variants.find((variant) => variant.variantKey === variantKey)
          ?.contentHash ?? null,
      rates: { replyRate: replyRateOf(measured) },
      replies: counts.replied,
      sent: counts.sent,
      variantKey,
    };
  });

/** Above the bar only on enough replies; at or under it is a `false` at any count. */
const earnsPlaceOf = (
  low: number | null,
  counts: MetricCounts | null,
  minReplyRate: number
): boolean | null => {
  if (low === null) {
    return null;
  }

  if (low <= minReplyRate) {
    return false;
  }

  return (counts?.replied ?? 0) >= MIN_REPLIES ? true : null;
};

const draftOf = (
  index: number,
  step: Sequence["steps"][number] | undefined,
  stats: StepStats | undefined,
  minReplyRate: number
): Draft => {
  const counts: MetricCounts | null = stats?.total ?? null;

  const measured =
    counts === null ? null : measure(counts.replied, perLead(counts));

  return {
    action: step?.action ?? null,
    delayDays: step?.delayDays ?? null,
    earnsPlace: earnsPlaceOf(measured?.low ?? null, counts, minReplyRate),
    inSequence: step !== undefined,
    parent: step === undefined ? null : step.parentIndex,
    rates: { replyRate: replyRateOf(measured) },
    replies: counts?.replied ?? null,
    sent: counts?.sent ?? null,
    ...stepAt(index),
    variants: variantsOf(stats, step),
  };
};

const finish = (
  drafts: readonly Draft[],
  allReplies: number | null
): FunnelStep[] =>
  drafts.map(({ parent, ...draft }, position) => {
    // A step in the sequence follows its parent; one known only from stats follows the row above.
    const before = draft.inSequence
      ? drafts.find((other) => other.stepIndex === parent)
      : drafts[position - 1];

    const drop =
      before === undefined || before.sent === null || draft.sent === null
        ? null
        : before.sent - draft.sent;

    return {
      ...draft,
      sentDrop: drop,
      sentDropRate: rate(drop, before?.sent ?? null),
      shareOfReplies: rate(draft.replies, allReplies),
    };
  });

const topOf = (steps: readonly FunnelStep[]): FunnelStep | null => {
  let top: FunnelStep | null = null;

  for (const step of steps) {
    if ((step.replies ?? 0) > (top?.replies ?? 0)) {
      top = step;
    }
  }

  return top;
};

const sentence = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const describe = (
  steps: readonly FunnelStep[],
  top: FunnelStep | null,
  last: FunnelStep | null,
  allReplies: number | null
): string => {
  if (steps.every((step) => step.sent === null)) {
    return "No step has stats yet, so there is nothing to compare.";
  }

  if (top === null) {
    return "No step has a reply in this range.";
  }

  const length = steps.filter((step) => step.inSequence).length || null;
  const lead = `${sentence(stepLabel(top.stepIndex, length))} brings the most replies: ${top.replies} of ${allReplies}.`;

  if (last === null) {
    const tooFew = steps.some(
      (step) => step.earnsPlace === null && step.rates.replyRate.low !== null
    );

    return tooFew
      ? `${lead} Too few replies to tell whether any step's reply rate is reliably above the bar: a step needs at least ${MIN_REPLIES}.`
      : `${lead} No step's reply rate is reliably above the bar yet.`;
  }

  const later = steps.filter(
    (step) => step.stepIndex > last.stepIndex && step.sent !== null
  );

  return later.length === 0
    ? `${lead} Every step up to ${stepLabel(last.stepIndex, length)} still earns its place.`
    : `${lead} ${sentence(stepLabel(last.stepIndex, length))} is the last whose reply rate is reliably above the bar; the ${later.length === 1 ? "1 later step" : `${later.length} later steps`} sent ${total(later.map((step) => step.sent))} messages for ${total(later.map((step) => step.replies)) ?? "an unknown number of"} replies.`;
};

/** Day by day, the rows of each step added up (variants into their step). */
const daysOf = (rows: readonly MetricRow[]): FunnelDay[] => {
  const byDate = groupBy(
    rows.filter((row) => row.date !== null && row.stepIndex !== null),
    (row) => row.date ?? ""
  );

  return [...byDate]
    .map(([date, group]) => ({
      date,
      steps: [...splitStats(group).steps]
        .toSorted(([left], [right]) => left - right)
        .map(([index, stats]) => ({
          replies: stats.total?.replied ?? null,
          sent: stats.total?.sent ?? null,
          stepIndex: index,
          stepNumber: index + 1,
        })),
    }))
    .toSorted((left, right) => left.date.localeCompare(right.date));
};

const unattributedOf = (rows: readonly MetricRow[]) => {
  const counts = sumRows(rows);

  return { replies: counts.replied, rows: rows.length, sent: counts.sent };
};

export const stepFunnel = defineInsight({
  description:
    "Where a campaign's replies come from: one row per sequence step with its action, delay, sends, replies, reply rate with a 95% interval, share of all replies and the drop in sends from the step before, plus rows per variant when the vendor splits them. stepIndex counts from 0, stepNumber from 1. Names the step with the most replies and the last step that still earns its place. Use it to decide whether to cut or rewrite follow-ups. Costs 2 requests. With by_day it also returns each day's sends and replies per step, for one more request, on an adapter with step stats by day. A null count is not reported, never 0.",
  inputSchema: input,
  key: "stepFunnel",
  cost: (values, price) =>
    price.one("sequence.get") + (values.by_day ? 2 : 1) * price.one("stats"),
  name: "step_funnel",
  needs: ["sequence", "stats.byStep"],
  needsFor: ({ by_day: byDay }) => (byDay ? ["stats.byStepDay"] : []),
  next: "Use variant_test on the same campaign to see whether a step's A/B winner is real, or copy_audit to check the copy of a weak step.",
  run: async (
    context,
    { by_day: byDay, campaign, from, min_reply_rate: bar, to }
  ) => {
    const handle = context.outbound.campaign(campaign);
    const sequence = context.one(await handle.sequence());

    const rows = context.rows(
      await handle.stats({ ...rangeOf(from, to), scope: "step" })
    );

    const days = byDay
      ? daysOf(
          context.rows(
            await handle.stats({
              ...rangeOf(from, to),
              by: "day",
              scope: "step",
            })
          )
        )
      : null;

    const split = splitStats(rows);

    const indexes = [
      ...new Set([
        ...sequence.steps.map((step) => step.index),
        ...split.steps.keys(),
      ]),
    ].toSorted((left, right) => left - right);

    const drafts = indexes.map((index) =>
      draftOf(
        index,
        sequence.steps.find((step) => step.index === index),
        split.steps.get(index),
        bar
      )
    );

    const unattributed = unattributedOf(split.unattributed);

    const allReplies = total([
      ...drafts.map((draft) => draft.replies),
      unattributed.replies,
    ]);

    const steps = finish(drafts, allReplies);
    const top = topOf(steps);
    const last = steps.findLast((step) => step.earnsPlace === true) ?? null;

    if (unattributed.rows > 0) {
      context.note(
        "Some counts are tied to no step by the vendor; they are reported as unattributed and are in no step's row."
      );
    }

    const funnel: StepFunnel = {
      campaign: refOf(context.outbound, campaign),
      days,
      finding: describe(steps, top, last, allReplies),
      lastStepEarningPlace: last?.stepIndex ?? null,
      lastStepEarningPlaceIndex: last?.stepIndex ?? null,
      lastStepEarningPlaceNumber: last?.stepNumber ?? null,
      steps,
      topStep: top?.stepIndex ?? null,
      topStepIndex: top?.stepIndex ?? null,
      topStepNumber: top?.stepNumber ?? null,
      totals: {
        replies: allReplies,
        sent: total([...drafts.map((draft) => draft.sent), unattributed.sent]),
      },
      unattributed,
    };

    return funnel;
  },
});
