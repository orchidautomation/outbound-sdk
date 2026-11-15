// campaign_ranking: which campaigns are best, ranked so a small sample
// cannot win on luck.

import { z } from "zod";

import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import { median, round } from "../stats.ts";
import {
  descending,
  labelOf,
  listFields,
  rangeFields,
  ratesOf,
  readCampaignTotals,
  volumeOf,
} from "./shared.ts";
import type {
  Base,
  CampaignLabel,
  CampaignTotals,
  Measured,
  OpenRange,
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
}

const measured = (
  counts: Totals,
  metric: RankingMetric,
  base?: Base
): Measured => {
  const rates = ratesOf(counts, base);

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
  left.name.localeCompare(right.name);

/**
 * Ranks campaigns that sent enough, and sets the rest aside with the reason.
 * `base` is what replies are divided by; leads contacted by default.
 */
export const rankCampaigns = (
  entries: readonly CampaignTotals[],
  metric: RankingMetric,
  minSent: number,
  base?: Base
): Ranking => {
  const scored: Scored[] = [];
  const tooFewSends: UnrankedCampaign[] = [];
  const unknown: UnrankedCampaign[] = [];

  for (const { campaign, counts } of entries) {
    const label = labelOf(campaign);
    const volume = volumeOf(counts);
    const result = measured(counts, metric, base);

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
      scored.push({ ...label, ...result, sent: volume });
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
    "Which campaigns are best, ranked fairly: by the low end of the 95% Wilson interval of the reply rate (or positive reply rate; for bounce rate, by the high end, lowest first), so 2 replies from 10 sends cannot outrank 150 from 1,000. Use it to pick winners and losers across a workspace. Returns each campaign with its count, rate, interval and rank, the campaigns left out for too few sends, those whose count the vendor does not report (a null rate is unknown, not zero), and the gap between the top and the median. Costs one listing per status plus one stats request per campaign (one for all of them on a vendor that reports every campaign in one call with every count).",
  inputSchema: input,
  key: "campaignRanking",
  name: "campaign_ranking",
  needs: ["stats.campaign"],
  next: "Use campaign_diagnosis on the campaign ranked last to see why it is behind.",
  run: async (context, options) => {
    const { entries, read } = await readCampaignTotals(context, options);

    const ranking: CampaignRanking = {
      ...rankCampaigns(entries, options.metric, options.min_sent),
      ...read,
      better: options.metric === "bounce_rate" ? "lower" : "higher",
      metric: options.metric,
      period: { from: options.from, to: options.to },
    };

    return ranking;
  },
});
