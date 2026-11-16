// step_funnel: which step of a sequence the replies come from.

import { z } from "zod";

import type { MetricRow, Sequence } from "../../internal/entities.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { refOf } from "../ref.ts";
import { rate, total } from "../stats.ts";
import {
  measure,
  perLead,
  rangeOf,
  replyRateOf,
  splitStats,
  sumRows,
} from "./shared.ts";
import type { BasedRate, StepStats } from "./shared.ts";

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe("The campaign's ref, for example `instantly:acme:abc123`"),
  ...rangeFields,
  min_reply_rate: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      "A step earns its place when the low end of its reply rate interval is above this. 0 asks only that the rate is reliably above zero."
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

export interface FunnelStep {
  /** Counted from 0. */
  readonly step: number;
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
  /** `true` when the low end of the reply rate interval is above `min_reply_rate`. `null` when the rate is unknown. */
  readonly earnsPlace: boolean | null;
  /** Empty when the vendor does not split step stats by variant. */
  readonly variants: readonly FunnelVariant[];
}

export interface StepFunnel {
  readonly campaign: string;
  /** What the numbers say, in one or two sentences. */
  readonly finding: string;
  /** The step with the most replies. `null` when no step has a reply. */
  readonly topStep: number | null;
  /** The last step whose reply rate is reliably above `min_reply_rate`. `null` when none is. */
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
    earnsPlace:
      measured === null || measured.low === null
        ? null
        : measured.low > minReplyRate,
    inSequence: step !== undefined,
    parent: step === undefined ? null : step.parentIndex,
    rates: { replyRate: replyRateOf(measured) },
    replies: counts?.replied ?? null,
    sent: counts?.sent ?? null,
    step: index,
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
      ? drafts.find((other) => other.step === parent)
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

  // A person counts steps from 1; `step` in the answer counts from 0.
  const lead = `Step ${top.step + 1} brings the most replies: ${top.replies} of ${allReplies}.`;

  if (last === null) {
    return `${lead} No step's reply rate is reliably above the bar yet.`;
  }

  const later = steps.filter(
    (step) => step.step > last.step && step.sent !== null
  );

  return later.length === 0
    ? `${lead} Every step up to step ${last.step + 1} still earns its place.`
    : `${lead} Step ${last.step + 1} is the last whose reply rate is reliably above the bar; the ${later.length === 1 ? "1 later step" : `${later.length} later steps`} sent ${total(later.map((step) => step.sent))} messages for ${total(later.map((step) => step.replies)) ?? "an unknown number of"} replies.`;
};

const unattributedOf = (rows: readonly MetricRow[]) => {
  const counts = sumRows(rows);

  return { replies: counts.replied, rows: rows.length, sent: counts.sent };
};

export const stepFunnel = defineInsight({
  description:
    "Where a campaign's replies come from: one row per sequence step with its action, delay, sends, replies, reply rate with a 95% interval, its share of all replies and how far sends fell from the step before, plus rows per variant when the vendor splits them. Names the step with the most replies and the last step that still earns its place. Use it to decide whether to cut or rewrite follow-ups. Costs 2 requests. A null count means the vendor does not report it; it is never 0.",
  inputSchema: input,
  key: "stepFunnel",
  cost: (_input, price) => price.one("sequence.get") + price.one("stats"),
  name: "step_funnel",
  needs: ["sequence", "stats.byStep"],
  next: "Use variant_test on the same campaign to see whether a step's A/B winner is real, or copy_audit to check the copy of a weak step.",
  run: async (context, { campaign, from, min_reply_rate: bar, to }) => {
    const handle = context.outbound.campaign(campaign);
    const sequence = context.one(await handle.sequence());

    const rows = context.rows(
      await handle.stats({ ...rangeOf(from, to), scope: "step" })
    );

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
      finding: describe(steps, top, last, allReplies),
      lastStepEarningPlace: last?.step ?? null,
      steps,
      topStep: top?.step ?? null,
      totals: {
        replies: allReplies,
        sent: total([...drafts.map((draft) => draft.sent), unattributed.sent]),
      },
      unattributed,
    };

    return funnel;
  },
});
