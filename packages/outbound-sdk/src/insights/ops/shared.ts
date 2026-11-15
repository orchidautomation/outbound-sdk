// Reads and arithmetic the ops insights share: the campaigns of a workspace
// with their totals for a date range, one row of counts per day, the windows
// "the last N days" and "the N days before", and a rate with its interval.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Campaign, CampaignStatus } from "../../internal/entities.ts";
import { sumCounts } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { campaignsReadOf, readCampaignsIn } from "../capped.ts";
import type { CampaignsRead } from "../capped.ts";
import type { InsightContext } from "../define.ts";
import { statusesInput } from "../fields.ts";
import { rate, total, wilson } from "../stats.ts";

const DAY_MS = 86_400_000;

/** The UTC day of a time, as `YYYY-MM-DD`. */
export const dayOf = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

/** The day `days` after `day` (before it when negative). */
export const shiftDay = (day: string, days: number): string =>
  dayOf(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS);

export interface DayRange {
  /** Inclusive `YYYY-MM-DD`. */
  readonly from: string;
  /** Inclusive `YYYY-MM-DD`. */
  readonly to: string;
}

/**
 * The `days` complete UTC days that end yesterday. Today is left out because
 * it is not over. `back` 1 gives the `days` before those.
 */
export const lastDays = (now: number, days: number, back = 0): DayRange => ({
  from: dayOf(now - days * (back + 1) * DAY_MS),
  to: dayOf(now - (days * back + 1) * DAY_MS),
});

export interface OpenRange {
  /** Inclusive `YYYY-MM-DD`, or `null` for the start of the vendor's history. */
  readonly from: string | null;
  /** Inclusive `YYYY-MM-DD`, or `null` for today. */
  readonly to: string | null;
}

/** Input fields the campaign-listing insights share. */
export const listFields = (costPerCampaign: string) => ({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe(`The most campaigns to read. Each costs ${costPerCampaign}.`),
  statuses: statusesInput(["active", "paused", "completed"]),
});

export interface CampaignLabel {
  /** The campaign's ref. */
  readonly campaign: string;
  readonly campaignName: string;
  /** @deprecated Use `campaignName`. Removed in 0.5.0. */
  readonly name: string;
  readonly status: CampaignStatus;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
}

export const labelOf = (campaign: Campaign): CampaignLabel => ({
  campaign: campaign.ref,
  campaignName: campaign.name,
  channel: campaign.channel,
  name: campaign.name,
  provider: campaign.provider,
  status: campaign.status,
});

/** The counts every ops answer shows. `null` is a count the vendor does not report. */
export interface Totals {
  readonly sent: number | null;
  readonly contacted: number | null;
  readonly replied: number | null;
  readonly positive: number | null;
  readonly bounced: number | null;
}

export const totalsOf = (counts: Totals): Totals => ({
  bounced: counts.bounced,
  contacted: counts.contacted,
  positive: counts.positive,
  replied: counts.replied,
  sent: counts.sent,
});

/** A rate with the counts behind it and its 95% Wilson interval. */
export interface Measured {
  readonly count: number | null;
  /** What the count is divided by. */
  readonly of: number | null;
  readonly rate: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

export const measure = (count: number | null, of: number | null): Measured => {
  const interval = wilson(count, of);

  return {
    count,
    high: interval?.high ?? null,
    low: interval?.low ?? null,
    of,
    rate: rate(count, of),
  };
};

/** What a reply rate divides by: leads contacted or messages sent. */
export type ReplyBasis = "contacted" | "sent";

/** What a rate's replies are divided by. */
export type Base = (counts: Totals) => number | null;

/** The base of one basis: `baseIn("sent")` divides by messages sent. */
export const baseIn =
  (basis: ReplyBasis): Base =>
  (counts) =>
    counts[basis];

/** What a per-lead rate divides by: leads contacted, or messages sent when the vendor does not count leads. */
export const perLeadBasis = (counts: Totals): ReplyBasis =>
  counts.contacted !== null && counts.contacted > 0 ? "contacted" : "sent";

export const perLeadBase: Base = (counts) => counts[perLeadBasis(counts)];

/**
 * What two periods divide replies by, the same for both: messages sent when
 * both report them, since replies in a week answer messages sent that week
 * to leads first contacted weeks before, so a week's leads contacted can be
 * far fewer than its replies. Otherwise leads contacted for both, so the
 * two rates are never over different bases.
 */
export const periodBasis = (
  current: Totals,
  previous: Totals
): ReplyBasis =>
  current.sent !== null && previous.sent !== null ? "sent" : "contacted";

/** The rate's name, to start a sentence: "Replies per message sent". */
export const RATE_WORDS: Readonly<Record<ReplyBasis, string>> = {
  contacted: "Replies per lead contacted",
  sent: "Replies per message sent",
};

export interface Rates {
  /** Replies divided by the base: leads contacted (or messages sent when contacted is unknown) unless the caller passes another. */
  readonly replyRate: Measured;
  /** Positive replies on the same base as the reply rate. */
  readonly positiveRate: Measured;
  /** Bounces divided by messages sent. */
  readonly bounceRate: Measured;
}

export const ratesOf = (counts: Totals, base: Base = perLeadBase): Rates => ({
  bounceRate: measure(counts.bounced, counts.sent),
  positiveRate: measure(counts.positive, base(counts)),
  replyRate: measure(counts.replied, base(counts)),
});

/** How many of the rows added up are behind a rate. */
export interface RateCoverage {
  /** Rows that report both the rate's count and what it divides by. */
  readonly counted: number;
  /** Rows that report either. One that reports neither adds nothing and is not left out of anything. */
  readonly of: number;
}

export interface MeasuredAcross extends RateCoverage {
  readonly measured: Measured;
}

/**
 * One rate over several rows (campaigns, or the tools of a combined
 * instance), counting only the rows that report both sides of it: one
 * campaign's bounces over every campaign's sends would understate the rate.
 */
export const measureAcross = <Row>(
  rows: readonly Row[],
  countOf: (row: Row) => number | null,
  baseOf: (row: Row) => number | null
): MeasuredAcross => {
  const sides = rows.map((row) => ({ base: baseOf(row), count: countOf(row) }));

  const pairs = sides.flatMap(({ base, count }) =>
    count === null || base === null ? [] : [{ base, count }]
  );

  return {
    counted: pairs.length,
    measured:
      pairs.length === 0
        ? measure(total(sides.map((side) => side.count)), null)
        : measure(
            total(pairs.map((pair) => pair.count)),
            total(pairs.map((pair) => pair.base))
          ),
    of: sides.filter((side) => side.base !== null || side.count !== null)
      .length,
  };
};

export interface RatesAcross {
  readonly rates: Rates;
  /** The rates that leave rows out, in words: `bounce rate (1 of 2)`. Empty when every row is in every rate. */
  readonly partial: readonly string[];
}

/** Names a rate that leaves rows out, or nothing when every row is in it. */
export const partialRate = (name: string, across: RateCoverage): string[] =>
  across.counted > 0 && across.counted < across.of
    ? [`${name} (${across.counted} of ${across.of})`]
    : [];

/** The three rates over several rows of counts, each over the rows that report it. */
export const ratesAcross = (
  rows: readonly Totals[],
  base: Base = perLeadBase
): RatesAcross => {
  const reply = measureAcross(rows, (row) => row.replied, base);
  const positive = measureAcross(rows, (row) => row.positive, base);

  const bounce = measureAcross(
    rows,
    (row) => row.bounced,
    (row) => row.sent
  );

  return {
    partial: [
      ...partialRate("reply rate", reply),
      ...partialRate("positive reply rate", positive),
      ...partialRate("bounce rate", bounce),
    ],
    rates: {
      bounceRate: bounce.measured,
      positiveRate: positive.measured,
      replyRate: reply.measured,
    },
  };
};

/** The note for rates that leave rows out. `where` names the group, for example `Tag saas`. */
export const partialNote = (
  where: string,
  partial: readonly string[],
  rows = "campaigns"
): string =>
  `${where}: ${partial.join(", ")} ${partial.length === 1 ? "counts" : "count"} only the ${rows} that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.`;

/** How much a campaign sent: messages, or leads contacted when messages are not reported. */
export const volumeOf = (counts: Totals): number | null =>
  counts.sent ?? counts.contacted;

/** Largest first, with unknown values last. */
export const descending = (
  left: number | null,
  right: number | null
): number => {
  if (left === null || right === null) {
    return Number(left === null) - Number(right === null);
  }

  return right - left;
};

/** One campaign's counts over a range, added up. Every count is `null` when the vendor reports nothing. */
export const readTotals = async (
  context: InsightContext,
  campaign: string,
  range: OpenRange
): Promise<MetricCounts> =>
  sumCounts(
    context.rows(
      await context.outbound
        .campaign(campaign)
        .stats({ from: range.from ?? undefined, to: range.to ?? undefined })
    )
  );

export interface CampaignTotals {
  readonly campaign: Campaign;
  readonly counts: MetricCounts;
}

export interface EveryCampaignTotals {
  readonly entries: CampaignTotals[];
  readonly read: CampaignsRead;
}

export interface ListInput extends OpenRange {
  readonly max_campaigns: number;
  readonly statuses: readonly CampaignStatus[];
}

// Every campaign's totals from one request, by campaign ref. Only where the
// vendor's per-campaign report carries every count the read of one campaign
// does (`stats.allCampaigns` is `full`), so nothing is lost by using it.
const readAllTotals = async (
  context: InsightContext,
  range: OpenRange
): Promise<Map<string, MetricCounts> | undefined> => {
  if (context.outbound.capabilities["stats.allCampaigns"] !== "full") {
    return undefined;
  }

  const rows = context.rows(
    await context.outbound.stats({
      from: range.from ?? undefined,
      scope: "campaign",
      to: range.to ?? undefined,
    })
  );

  const byCampaign = new Map<string, MetricCounts[]>();

  for (const row of rows) {
    byCampaign.set(row.scopeRef, [
      ...(byCampaign.get(row.scopeRef) ?? []),
      row,
    ]);
  }

  return new Map(
    [...byCampaign].map(([ref, counts]) => [ref, sumCounts(counts)])
  );
};

/**
 * Every campaign in the given states with its totals for the range: one
 * stats request for all of them where the vendor reports every campaign in
 * one call with every count, otherwise one request each. A campaign the
 * one-call report leaves out is read on its own, so it is never shown as
 * having no counts when it has some.
 */
export const readCampaignTotals = async (
  context: InsightContext,
  input: ListInput
): Promise<EveryCampaignTotals> => {
  const listed = await readCampaignsIn(
    context,
    input.statuses,
    input.max_campaigns
  );

  const campaigns = listed.items;

  const reported =
    campaigns.length > 1 ? await readAllTotals(context, input) : undefined;

  const entries = await mapConcurrent(
    campaigns,
    async (campaign): Promise<CampaignTotals> => ({
      campaign,
      counts:
        reported?.get(campaign.ref) ??
        (await readTotals(context, campaign.ref, input)),
    })
  );

  return { entries, read: campaignsReadOf(listed) };
};

export interface DayCounts {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly counts: MetricCounts;
}

/**
 * One entry per day the vendor reports, oldest first, for a campaign or for
 * the workspace when `campaign` is `null`. Rows of the same day (one per
 * tool on a combined instance) are added together.
 */
export const readDaily = async (
  context: InsightContext,
  campaign: string | null,
  range: DayRange
): Promise<DayCounts[]> => {
  const options = { by: "day", from: range.from, to: range.to } as const;

  const rows = context.rows(
    campaign === null
      ? await context.outbound.stats(options)
      : await context.outbound.campaign(campaign).stats(options)
  );

  const days = new Map<string, MetricCounts[]>();

  for (const row of rows) {
    if (row.date !== null) {
      days.set(row.date, [...(days.get(row.date) ?? []), row]);
    }
  }

  return [...days]
    .map(([date, group]) => ({ counts: sumCounts(group), date }))
    .toSorted((left, right) => left.date.localeCompare(right.date));
};
