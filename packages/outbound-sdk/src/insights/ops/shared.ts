// Reads and arithmetic the ops insights share: the campaigns of a workspace
// with their totals for a date range, one row of counts per day, the windows
// "the last N days" and "the N days before", and a rate with its interval.

import { z } from "zod";

import { campaignStatusSchema } from "../../internal/entities.ts";
import type { Campaign, CampaignStatus } from "../../internal/entities.ts";
import { sumCounts } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import type { ListAll } from "../../internal/outbound/api.ts";
import type { InsightContext } from "../define.ts";
import { rate, wilson } from "../stats.ts";

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
  statuses: z
    .array(campaignStatusSchema)
    .min(1)
    .default(["active", "paused", "completed"])
    .describe("Only campaigns in one of these states are read"),
});

export const rangeFields = {
  from: z.iso
    .date()
    .nullable()
    .default(null)
    .describe("First day counted, YYYY-MM-DD. null for the whole history."),
  to: z.iso
    .date()
    .nullable()
    .default(null)
    .describe("Last day counted, YYYY-MM-DD. null for up to today."),
};

export interface CampaignLabel {
  /** The campaign's ref. */
  readonly campaign: string;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
}

export const labelOf = (campaign: Campaign): CampaignLabel => ({
  campaign: campaign.ref,
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

/** What a per-lead rate divides by: leads contacted, or messages sent when the vendor does not count leads. */
export const perLeadBase = (counts: Totals): number | null =>
  counts.contacted !== null && counts.contacted > 0
    ? counts.contacted
    : counts.sent;

export interface Rates {
  /** Replies divided by leads contacted (or messages sent when contacted is unknown). */
  readonly replyRate: Measured;
  /** Positive replies on the same base as the reply rate. */
  readonly positiveRate: Measured;
  /** Bounces divided by messages sent. */
  readonly bounceRate: Measured;
}

export const ratesOf = (counts: Totals): Rates => ({
  bounceRate: measure(counts.bounced, counts.sent),
  positiveRate: measure(counts.positive, perLeadBase(counts)),
  replyRate: measure(counts.replied, perLeadBase(counts)),
});

/** How much a campaign sent: messages, or leads contacted when messages are not reported. */
export const volumeOf = (counts: Totals): number | null =>
  counts.sent ?? counts.contacted;

/** `0.0525` as `5.3%`. */
export const percent = (value: number | null): string =>
  value === null ? "unknown" : `${Math.round(value * 1000) / 10}%`;

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

export interface Capped<Item> {
  readonly items: Item[];
  /** `false` when more records exist than the cap allowed. */
  readonly complete: boolean;
}

/**
 * Reads a listing up to `max` records. It asks for one record more than the
 * cap, so a listing that holds exactly `max` is not mistaken for a cut one,
 * and marks the answer incomplete when the extra record exists.
 */
export const readUpTo = async <Item>(
  context: InsightContext,
  list: (max: number) => ListAll<Item>,
  max: number
): Promise<Capped<Item>> => {
  const items = await context.all(list(max + 1));

  if (items.length > max) {
    context.partial("A listing was cut off at its cap; more records exist.");
  }

  return { complete: items.length <= max, items: items.slice(0, max) };
};

/**
 * The campaigns in the given states, up to `max`. Asks the vendor per state
 * when it can filter, and filters after reading when it cannot.
 */
export const readCampaigns = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number
): Promise<Campaign[]> => {
  const { campaigns } = context.outbound;
  const wanted = [...new Set(statuses)];

  if (context.outbound.capabilities["campaigns.status"] === false) {
    const every = await readUpTo(
      context,
      (cap) => campaigns.listAll({ max: cap }),
      max
    );

    return every.items.filter((campaign) => wanted.includes(campaign.status));
  }

  const found: Campaign[] = [];

  for (const status of wanted) {
    // oxlint-disable-next-line no-await-in-loop -- one listing per status keeps the rate budget predictable.
    const listed = await readUpTo(
      context,
      (cap) => campaigns.listAll({ max: cap, status }),
      max - found.length
    );

    found.push(...listed.items);
  }

  return found;
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

export interface ListInput extends OpenRange {
  readonly max_campaigns: number;
  readonly statuses: readonly CampaignStatus[];
}

/** Every campaign in the given states with its totals for the range: one stats request each. */
export const readCampaignTotals = async (
  context: InsightContext,
  input: ListInput
): Promise<CampaignTotals[]> => {
  const campaigns = await readCampaigns(
    context,
    input.statuses,
    input.max_campaigns
  );

  const entries: CampaignTotals[] = [];

  for (const campaign of campaigns) {
    entries.push({
      campaign,
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      counts: await readTotals(context, campaign.ref, input),
    });
  }

  return entries;
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
