// pipeline_forecast: the leads a campaign has left and what they should
// produce. An estimate, and it says so.

import { z } from "zod";

import type { Campaign, Lead, LeadStatus } from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import { readCapped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { percent, round, spoken, total } from "../stats.ts";
import { labelOf, lastDays, ratesOf, readDaily, readTotals } from "./shared.ts";
import type { CampaignLabel, Measured } from "./shared.ts";

const input = z.object({
  campaign: z.string().min(3).describe("The campaign's ref"),
  days: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(7)
    .describe("How many complete days, ending yesterday, set the daily pace"),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(2000)
    .describe("The most leads to read. A page of leads is one request."),
});

/** A figure with the range the 95% interval of the rate gives. */
export interface Estimate {
  readonly expected: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

export interface PipelineForecast extends CampaignLabel {
  /** Always `true`: every figure below `remaining` is a projection, not a count. */
  readonly estimate: true;
  readonly leadsRead: number;
  /** `false` when `max_leads` stopped the read, so `remaining` is a minimum. */
  readonly leadsComplete: boolean;
  readonly byStatus: Readonly<Record<LeadStatus, number>>;
  /** Leads still active in the campaign: not replied, bounced, unsubscribed, paused or finished. */
  readonly remaining: number;
  /** New leads contacted per day over the last `days`. `null` when the vendor has no daily contacted count. */
  readonly dailyContactRate: number | null;
  /**
   * `remaining` divided by `dailyContactRate`, and `0` when every lead was
   * read and none is left. `null` when the remaining leads are unknown (the
   * cap stopped the read, or a lead's status is unknown) or some remain with
   * no contact rate to divide by.
   */
  readonly daysLeft: number | null;
  /** The campaign's reply rate so far, over its whole history. */
  readonly replyRate: Measured;
  readonly positiveRate: Measured;
  readonly expectedReplies: Estimate;
  readonly expectedPositive: Estimate;
  readonly assumptions: readonly string[];
  readonly finding: string;
}

const countStatuses = (leads: readonly Lead[]): Record<LeadStatus, number> => {
  const counts: Record<LeadStatus, number> = {
    active: 0,
    bounced: 0,
    completed: 0,
    paused: 0,
    replied: 0,
    unknown: 0,
    unsubscribed: 0,
  };

  for (const lead of leads) {
    counts[lead.status] += 1;
  }

  return counts;
};

const times = (leads: number, share: number | null): number | null =>
  share === null ? null : round(leads * share);

const project = (leads: number, measured: Measured): Estimate => ({
  expected: times(leads, measured.rate),
  high: times(leads, measured.high),
  low: times(leads, measured.low),
});

/** New leads contacted per day over the last `days`, or `null` when it cannot be known. */
const paceOf = async (
  context: InsightContext,
  campaign: string,
  days: number
): Promise<number | null> => {
  if (context.outbound.capabilities["stats.byDay"] === false) {
    context.note(
      "Days of sending left were not estimated: the adapter has no stats by day."
    );

    return null;
  }

  const series = await readDaily(
    context,
    campaign,
    lastDays(context.now, days)
  );

  const contacted = total(series.map((day) => day.counts.contacted));

  return contacted === null ? null : round(contacted / days);
};

const ASSUMPTIONS = [
  "Every remaining lead is contacted.",
  "Remaining leads reply at the rate the campaign has had so far; leads already partway through the sequence may reply less.",
  "The daily pace stays what it was over the recent days. Days with no report count as no sends.",
];

interface Left {
  readonly remaining: number;
  readonly complete: boolean;
  readonly daysLeft: number | null;
}

/** Days of sending left. See `PipelineForecast.daysLeft`. */
const daysLeftOf = (
  byStatus: Readonly<Record<LeadStatus, number>>,
  complete: boolean,
  pace: number | null
): number | null => {
  const remaining = byStatus.active;

  if (remaining === 0) {
    return complete && byStatus.unknown === 0 ? 0 : null;
  }

  return pace === null || pace <= 0 ? null : round(remaining / pace);
};

const describe = (
  { complete, daysLeft, remaining }: Left,
  forecast: Estimate
): string => {
  if (daysLeft === 0) {
    return "No leads are left to contact; add leads to keep the campaign sending.";
  }

  const leads = `${complete ? "" : "At least "}${plural(remaining, "lead")} ${noun(remaining, "remains", "remain")}`;

  if (forecast.expected === null) {
    return `${leads}; replies cannot be estimated because the vendor reports no reply rate yet.`;
  }

  const [expected, low, high] = [
    forecast.expected,
    forecast.low,
    forecast.high,
  ].map((value) => spoken(value));

  // A range whose ends read the same says nothing, so it is left out.
  const range = low === high ? "" : ` (between ${low} and ${high})`;

  return `${leads}; expect about ${expected} ${noun(Number(expected), "reply", "replies")}${range}. This is an estimate.`;
};

export interface ForecastOptions {
  readonly days: number;
  readonly maxLeads: number;
  /** The input `maxLeads` came from, for the note when it stops the read. */
  readonly leadsInput: string;
  /** What `maxLeads` counts, for that note: `leads`, or `leads of a campaign`. */
  readonly leadsWhat: string;
}

/** Reads one campaign's leads, totals and recent pace, and projects what is left. */
export const forecastCampaign = async (
  context: InsightContext,
  campaign: Campaign,
  options: ForecastOptions
): Promise<PipelineForecast> => {
  const handle = context.outbound.campaign(campaign.ref);

  const { capped, items: leads } = await readCapped(
    context,
    (max) => handle.leads.listAll({ max }),
    {
      input: options.leadsInput,
      max: options.maxLeads,
      what: options.leadsWhat,
    }
  );

  const complete = !capped;

  const byStatus = countStatuses(leads);
  const remaining = byStatus.active;

  const rates = ratesOf(
    await readTotals(context, campaign.ref, { from: null, to: null })
  );

  const pace = await paceOf(context, campaign.ref, options.days);
  const expectedReplies = project(remaining, rates.replyRate);
  const daysLeft = daysLeftOf(byStatus, complete, pace);

  return {
    ...labelOf(campaign),
    assumptions: [
      ...ASSUMPTIONS,
      `The reply rate so far is ${percent(rates.replyRate.rate)}, from ${rates.replyRate.count === null ? "an unknown number of replies" : plural(rates.replyRate.count, "reply", "replies")} over ${rates.replyRate.of ?? "unknown"}.`,
    ],
    byStatus,
    dailyContactRate: pace,
    daysLeft,
    estimate: true,
    expectedPositive: project(remaining, rates.positiveRate),
    expectedReplies,
    finding: describe({ complete, daysLeft, remaining }, expectedReplies),
    leadsComplete: complete,
    leadsRead: leads.length,
    positiveRate: rates.positiveRate,
    remaining,
    replyRate: rates.replyRate,
  };
};

export const pipelineForecast = defineInsight({
  description:
    "The leads one campaign has left and what they should produce: leads counted by status, the leads still active, the days of sending left at the recent daily contact rate, and the replies and positive replies to expect from the remaining leads at the campaign's reply rate so far, each with a low and a high figure from the 95% interval. Use it to decide when to load more leads. It is an estimate and lists what it assumes; a null means the vendor does not report the count behind it. Costs one request per page of leads, plus two stats requests.",
  inputSchema: input,
  key: "pipelineForecast",
  name: "pipeline_forecast",
  needs: ["leads.byCampaign", "stats.campaign"],
  next: "Use client_report to see every campaign that is running out of leads.",
  run: async (context, options) => {
    const campaign = context.one(
      await context.outbound.campaigns.get(options.campaign)
    );

    return await forecastCampaign(context, campaign, {
      days: options.days,
      leadsInput: "max_leads",
      leadsWhat: "leads",
      maxLeads: options.max_leads,
    });
  },
});
