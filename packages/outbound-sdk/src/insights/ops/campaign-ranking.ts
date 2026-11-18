// campaign_ranking: which campaigns are best, ranked so a small sample
// cannot win on luck.

import { z } from "zod";

import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { median, round } from "../stats.ts";
import {
  baseIn,
  campaignTotalsCost,
  descending,
  labelOf,
  listFields,
  perLeadBasis,
  ratesOf,
  readCampaignTotals,
  toolsLeftOut,
  volumeOf,
} from "./shared.ts";
import type {
  CampaignLabel,
  CampaignTotals,
  Measured,
  OpenRange,
  ReplyBasis,
  ToolLeftOut,
  Totals,
} from "./shared.ts";

const metricSchema = z.enum([
  "reply_rate",
  "positive_reply_rate",
  "bounce_rate",
]);

export type RankingMetric = z.infer<typeof metricSchema>;

const input = z.object({
  ...rangeFields,
  ...listFields("one stats request"),
  metric: metricSchema
    .default("reply_rate")
    .describe("The rate to rank by. For bounce_rate, lower is better."),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(50)
    .describe("Campaigns with fewer sends than this are left out of the rank"),
});

export interface RankedCampaign extends CampaignLabel, Measured {
  /** 1 is the best. */
  readonly rank: number;
  /** What `of` counts: leads contacted or messages sent. Always `sent` for bounce rate. */
  readonly basis: ReplyBasis;
  /** Messages sent. `null` when the vendor does not report them. */
  readonly sent: number | null;
}

export interface UnrankedCampaign extends CampaignLabel {
  readonly sent: number | null;
  readonly reason: string;
}

export interface RankingGap {
  /** The rate of the campaign ranked first. */
  readonly top: number | null;
  /** The median rate of the ranked campaigns. */
  readonly median: number | null;
  /** `top` minus `median`. */
  readonly difference: number | null;
}

export interface Ranking {
  /** Best first: by the low end of the interval, or by the high end, lowest first, for bounce rate. */
  readonly ranked: readonly RankedCampaign[];
  readonly tooFewSends: readonly UnrankedCampaign[];
  /** Campaigns whose count for this metric the vendor does not report. */
  readonly unknown: readonly UnrankedCampaign[];
  readonly gap: RankingGap;
}

export interface CampaignRanking extends Ranking, CampaignsRead {
  readonly metric: RankingMetric;
  readonly better: "higher" | "lower";
  readonly period: OpenRange;
  /**
   * Tools of a combined instance none of whose campaigns is in `statuses`,
   * so none of theirs is ranked, each with its own workspace totals for
   * `period`. Always set by the insight; optional so a value built by hand
   * stays valid.
   */
  readonly toolsLeftOut?: readonly ToolLeftOut[];
}

const measured = (
  counts: Totals,
  metric: RankingMetric,
  basis: ReplyBasis
): Measured => {
  const rates = ratesOf(counts, baseIn(basis));

  if (metric === "bounce_rate") {
    return rates.bounceRate;
  }

  return metric === "reply_rate" ? rates.replyRate : rates.positiveRate;
};

type Scored = Omit<RankedCampaign, "rank">;

const order = (metric: RankingMetric) => (left: Scored, right: Scored) =>
  (metric === "bounce_rate"
    ? descending(right.high, left.high) || descending(right.rate, left.rate)
    : descending(left.low, right.low) || descending(left.rate, right.rate)) ||
  left.campaignName.localeCompare(right.campaignName);

/**
 * Ranks campaigns that sent enough, and sets the rest aside with the reason.
 * `replyBasis` is what replies are divided by; by default leads contacted,
 * or messages sent for a campaign that does not count leads.
 */
export const rankCampaigns = (
  entries: readonly CampaignTotals[],
  metric: RankingMetric,
  minSent: number,
  replyBasis?: ReplyBasis
): Ranking => {
  const scored: Scored[] = [];
  const tooFewSends: UnrankedCampaign[] = [];
  const unknown: UnrankedCampaign[] = [];

  for (const { campaign, counts } of entries) {
    const label = labelOf(campaign);
    const volume = volumeOf(counts);

    const basis =
      metric === "bounce_rate" ? "sent" : (replyBasis ?? perLeadBasis(counts));

    const result = measured(counts, metric, basis);

    if (volume === null) {
      unknown.push({
        ...label,
        reason: "The vendor reports no sends for this period.",
        sent: null,
      });
    } else if (volume < minSent) {
      tooFewSends.push({
        ...label,
        reason: `${volume} sends, under the ${minSent} needed to rank.`,
        sent: volume,
      });
    } else if (result.rate === null) {
      unknown.push({
        ...label,
        reason: "The vendor does not report the count behind this rate.",
        sent: volume,
      });
    } else {
      scored.push({ ...label, ...result, basis, sent: counts.sent });
    }
  }

  const ranked = scored
    .toSorted(order(metric))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const top = ranked[0]?.rate ?? null;
  const middle = median(ranked.flatMap((entry) => entry.rate ?? []));

  return {
    gap: {
      difference: top === null || middle === null ? null : round(top - middle),
      median: round(middle),
      top,
    },
    ranked,
    tooFewSends,
    unknown,
  };
};

export const campaignRanking = defineInsight({
  description:
    "Which campaigns are best, ranked fairly: by the low end of the 95% Wilson interval of the rate (for bounce rate the high end, lowest first), so 2 replies from 10 sends cannot outrank 150 from 1,000. Use it to pick winners and losers across a workspace. Returns each campaign's count, rate, interval and rank, the campaigns left out for too few sends or an unreported count, and the gap between the top and the median. Costs one listing per status plus one stats request per campaign, or one for all of them on a vendor that reports every campaign in one call.",
  inputSchema: input,
  key: "campaignRanking",
  cost: campaignTotalsCost,
  scales: "max_campaigns",
  name: "campaign_ranking",
  needs: ["stats.campaign"],
  partialOnCap: true,
  next: "Use campaign_diagnosis on the campaign ranked last to see why it is behind.",
  run: async (context, options) => {
    const { entries, read, skipped } = await readCampaignTotals(
      context,
      options
    );

    const period = { from: options.from, to: options.to };

    const ranking: CampaignRanking = {
      ...rankCampaigns(entries, options.metric, options.min_sent),
      ...read,
      better: options.metric === "bounce_rate" ? "lower" : "higher",
      metric: options.metric,
      period,
      toolsLeftOut: await toolsLeftOut(context, skipped, period),
    };

    return ranking;
  },
});
