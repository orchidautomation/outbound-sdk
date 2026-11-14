// copy_reuse: how the same piece of copy performs in different campaigns.

import { z } from "zod";

import { campaignStatusSchema } from "../../internal/entities.ts";
import type { Campaign, Sequence } from "../../internal/entities.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { compareRates, round, total } from "../stats.ts";
import type { Interval } from "../stats.ts";
import {
  campaignsIn,
  groupBy,
  measure,
  perLead,
  splitStats,
} from "./shared.ts";
import type { Measured, SplitStats } from "./shared.ts";

const input = z.object({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe(
      "The most campaigns to read. Each costs 2 requests: its sequence and its step stats."
    ),
  min_sent: z
    .number()
    .int()
    .min(1)
    .default(100)
    .describe(
      "The smallest base (sends, or leads contacted when the vendor counts those) a campaign needs to count in the spread, and a piece of copy needs to be named the best."
    ),
  statuses: z
    .array(campaignStatusSchema)
    .min(1)
    .default(["active", "paused", "completed"])
    .describe("The campaign statuses to read."),
});

export interface CopyUse {
  readonly campaign: string;
  readonly campaignName: string;
  readonly provider: string;
  /** Where the copy sits in the campaign, as `step:variant` with steps counted from 0. */
  readonly places: readonly string[];
  readonly sent: number | null;
  readonly replies: number | null;
  /** What the rate is divided by. `null` when the vendor reports no counts for this copy. */
  readonly trials: number | null;
  readonly replyRate: number | null;
  readonly replyRateInterval: Interval | null;
}

export interface CopyPiece {
  readonly contentHash: string;
  readonly subject: string | null;
  /** The first 120 characters of the body. */
  readonly bodyPreview: string | null;
  readonly campaigns: number;
  readonly sent: number | null;
  readonly replies: number | null;
  readonly trials: number | null;
  /** Replies over the base, added up across campaigns. */
  readonly replyRate: number | null;
  readonly replyRateInterval: Interval | null;
}

export interface ReusedCopy extends CopyPiece {
  /** Best reply rate first; a campaign with no known rate is last. */
  readonly uses: readonly CopyUse[];
  /** Best minus worst reply rate among campaigns with a base of `min_sent`. `null` with fewer than two such campaigns. */
  readonly spread: number | null;
  readonly best: string | null;
  readonly worst: string | null;
  /** Two-sided p-value of best against worst. `null` when there is no spread or both rates are 0. */
  readonly spreadPValue: number | null;
  /** `true` when the spread is more than chance at the usual 0.05 bar. */
  readonly spreadIsReal: boolean | null;
  readonly finding: string;
}

export interface CopyReuse {
  /** Copy used in two or more campaigns, widest spread first. */
  readonly reused: readonly ReusedCopy[];
  /** The copy with the highest pooled reply rate among those with a base of `min_sent`. `null` when none has. */
  readonly bestCopy: CopyPiece | null;
  readonly campaignsRead: number;
  readonly piecesOfCopy: number;
  /** Variants whose counts the vendor does not split out, so their copy has no numbers. */
  readonly variantsWithoutStats: number;
}

interface Placement {
  readonly contentHash: string;
  readonly subject: string | null;
  readonly body: string | null;
  readonly campaign: Campaign;
  readonly place: string;
  /** `null` when the vendor does not split the step's counts by variant. */
  readonly counts: MetricCounts | null;
}

const PREVIEW = 120;

const placementsOf = (
  campaign: Campaign,
  sequence: Sequence,
  stats: SplitStats
): Placement[] =>
  sequence.steps.flatMap((step) => {
    const found = stats.steps.get(step.index);

    return step.variants.flatMap((variant) => {
      // A variant with no text has nothing to compare across campaigns.
      if ((variant.subject ?? "") === "" && (variant.body ?? "") === "") {
        return [];
      }

      // A step's own total is this variant's only when the step has one variant.
      const whole = step.variants.length === 1 ? (found?.total ?? null) : null;

      return [
        {
          body: variant.body,
          campaign,
          contentHash: variant.contentHash,
          counts: found?.variants.get(variant.variantKey) ?? whole,
          place: `${step.index}:${variant.variantKey}`,
          subject: variant.subject,
        },
      ];
    });
  });

const pooled = (counts: readonly (MetricCounts | null)[]) => {
  // Only a use with both counts known enters the pooled rate, so a missing
  // reply count never drags the rate down.
  const measured: Measured[] = counts.flatMap((each) => {
    const one = each === null ? null : measure(each.replied, perLead(each));

    return one === null || one.rate === null ? [] : [one];
  });

  const replies = total(measured.map((each) => each.count));
  const trials = total(measured.map((each) => each.trials));

  return {
    ...measure(replies, { basis: null, trials }),
    sent: total(counts.map((each) => each?.sent ?? null)),
  };
};

const useOf = (placements: readonly Placement[]): CopyUse[] => {
  const [first] = placements;

  if (first === undefined) {
    return [];
  }

  const sum = pooled(placements.map((placement) => placement.counts));

  return [
    {
      campaign: first.campaign.ref,
      campaignName: first.campaign.name,
      places: placements.map((placement) => placement.place),
      provider: first.campaign.provider,
      replies: sum.count,
      replyRate: sum.rate,
      replyRateInterval: sum.interval,
      sent: sum.sent,
      trials: sum.trials,
    },
  ];
};

const pieceOf = (
  placements: readonly Placement[],
  uses: readonly CopyUse[]
): CopyPiece[] => {
  const [first] = placements;

  if (first === undefined) {
    return [];
  }

  const sum = pooled(placements.map((placement) => placement.counts));

  return [
    {
      bodyPreview: first.body?.slice(0, PREVIEW) ?? null,
      campaigns: uses.length,
      contentHash: first.contentHash,
      replies: sum.count,
      replyRate: sum.rate,
      replyRateInterval: sum.interval,
      sent: sum.sent,
      subject: first.subject,
      trials: sum.trials,
    },
  ];
};

interface Rated {
  readonly replyRate: number | null;
  readonly trials: number | null;
}

/** Best rate first; on a tie the larger base; an unknown rate last. */
const byRate = (left: Rated, right: Rated): number =>
  (right.replyRate ?? -1) - (left.replyRate ?? -1) ||
  (right.trials ?? 0) - (left.trials ?? 0);

const spreadOf = (uses: readonly CopyUse[], minSent: number) => {
  const judged = uses.filter(
    (use) => use.replyRate !== null && (use.trials ?? 0) >= minSent
  );

  const [best] = judged;
  const worst = judged.at(-1);

  if (best === undefined || worst === undefined || judged.length < 2) {
    return {
      best: null,
      finding: `Fewer than two campaigns have a base of ${minSent}, so the spread is not judged.`,
      spread: null,
      spreadIsReal: null,
      spreadPValue: null,
      worst: null,
    };
  }

  const test = compareRates(
    { successes: best.replies, trials: best.trials },
    { successes: worst.replies, trials: worst.trials }
  );

  const real = test?.significant ?? false;

  return {
    best: best.campaign,
    finding: real
      ? `The same copy gets ${best.replyRate} in ${best.campaignName} and ${worst.replyRate} in ${worst.campaignName}; the gap is more than chance, so the audience or the sender differs, not the copy.`
      : `The same copy gets ${best.replyRate} in ${best.campaignName} and ${worst.replyRate} in ${worst.campaignName}; a gap this size could be chance.`,
    spread: round((best.replyRate ?? 0) - (worst.replyRate ?? 0)),
    spreadIsReal: real,
    spreadPValue: test?.pValue ?? null,
    worst: worst.campaign,
  };
};

const readPlacements = async (
  context: InsightContext,
  campaigns: readonly Campaign[]
): Promise<Placement[]> => {
  const placements: Placement[] = [];

  for (const campaign of campaigns) {
    const handle = context.outbound.campaign(campaign.ref);
    // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
    const sequence = context.one(await handle.sequence());
    // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
    const rows = context.rows(await handle.stats({ scope: "step" }));

    placements.push(...placementsOf(campaign, sequence, splitStats(rows)));
  }

  return placements;
};

export const copyReuse = defineInsight({
  description:
    "How the same piece of copy performs in different campaigns. Reads each campaign's sequence and step stats, matches variants by the hash of their subject and body, and returns every piece of copy used in two or more campaigns with its totals, its reply rate per campaign and the spread between its best and worst campaign, plus the copy with the highest pooled reply rate. Use it to tell a copy problem from an audience problem. Costs 2 requests per campaign plus the campaign listing. A null count means the vendor does not report it for that variant; it is never 0.",
  inputSchema: input,
  key: "copyReuse",
  name: "copy_reuse",
  needs: ["sequence", "stats.byStep"],
  next: "Use step_funnel on the campaign where the copy does worst, or variant_test where the copy runs against another variant.",
  run: async (context, { max_campaigns, min_sent, statuses }) => {
    const campaigns = await campaignsIn(context, statuses, max_campaigns);
    const placements = await readPlacements(context, campaigns);
    const without = placements.filter((each) => each.counts === null).length;

    if (without > 0) {
      context.note(
        `${without} variant(s) have no counts of their own: the vendor reports their step as a whole, or not at all. Their copy is listed without numbers.`
      );
    }

    const pieces = [...groupBy(placements, (each) => each.contentHash)].flatMap(
      ([, group]) => {
        const uses = [...groupBy(group, (each) => each.campaign.ref).values()]
          .flatMap(useOf)
          .toSorted(byRate);

        return pieceOf(group, uses).map((piece) => ({ piece, uses }));
      }
    );

    const reused: ReusedCopy[] = pieces
      .flatMap(({ piece, uses }) =>
        uses.length < 2 ? [] : [{ ...piece, ...spreadOf(uses, min_sent), uses }]
      )
      .toSorted(
        (left, right) =>
          (right.spread ?? -1) - (left.spread ?? -1) ||
          (right.sent ?? 0) - (left.sent ?? 0)
      );

    const [bestCopy] = pieces
      .flatMap(({ piece }) =>
        piece.replyRate !== null && (piece.trials ?? 0) >= min_sent
          ? [piece]
          : []
      )
      .toSorted(byRate);

    const result: CopyReuse = {
      bestCopy: bestCopy ?? null,
      campaignsRead: campaigns.length,
      piecesOfCopy: pieces.length,
      reused,
      variantsWithoutStats: without,
    };

    return result;
  },
});
