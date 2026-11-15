// client_report: one report for one client or workspace, composed from what
// the other ops insights compute.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import { renamed } from "../../internal/renamed.ts";
import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { percent, spoken } from "../stats.ts";
import { findAnomalies } from "./anomalies.ts";
import type { Anomaly } from "./anomalies.ts";
import { rankCampaigns } from "./campaign-ranking.ts";
import type { RankedCampaign } from "./campaign-ranking.ts";
import { noted, readPeriods, totalOf } from "./period-comparison.ts";
import type { CampaignPeriods, Comparison } from "./period-comparison.ts";
import { forecastCampaign } from "./pipeline-forecast.ts";
import {
  labelOf,
  listFields,
  perMessageBase,
  ratesOf,
  readDaily,
  shiftDay,
  volumeOf,
} from "./shared.ts";
import type { CampaignLabel, DayRange } from "./shared.ts";

const limit = z.number().int().min(1).max(20);

const input = z.object({
  ...listFields(
    "two stats requests, and three more plus its leads when active"
  ),
  alpha: z
    .number()
    .gt(0)
    .lt(1)
    .default(0.05)
    .describe("The p-value under which a change counts as more than chance"),
  anomaly_threshold: z
    .number()
    .positive()
    .default(2.5)
    .describe("Standard deviations from the baseline that make a day unusual"),
  baseline_days: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(14)
    .describe("Days before the period that form the anomaly baseline"),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe("The length of the period, in complete days ending yesterday"),
  limit: limit.default(3).describe("How many best and worst campaigns to show"),
  max_bounce_rate: z
    .number()
    .min(0)
    .max(1)
    .default(0.03)
    .describe("A campaign bounce rate over this is a bounce problem"),
  max_leads_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(500)
    .describe("The most leads to read per active campaign, for leads left"),
  min_baseline_points: z
    .number()
    .int()
    .min(2)
    .default(5)
    .describe("The fewest baseline days with data a day needs to be tested"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(50)
    .describe("Campaigns under this many sends in the period are not judged"),
  runway_days: z
    .number()
    .min(0)
    .default(7)
    .describe(
      "A campaign with this many days of leads left or fewer is flagged"
    ),
  top: renamed("limit", limit),
});

type Options = z.infer<typeof input>;

// How long the leads last, for a sentence: "less than a day" when it rounds to
// nothing, so a runway of 0.03 days does not read as 0 days.
const sendingLeft = (daysLeft: number | null): string => {
  if (daysLeft !== null && daysLeft < 0.05) {
    return "less than a day of sending";
  }

  const days = spoken(daysLeft);

  return `about ${days} ${days === "1" ? "day" : "days"} of sending`;
};

export interface BounceProblem extends CampaignLabel {
  /** Bounces. The same as `bounced`. */
  readonly count: number | null;
  /** Messages sent, which the rate divides by. The same as `sent`. */
  readonly of: number | null;
  readonly bounced: number | null;
  readonly sent: number | null;
  readonly rate: number;
  readonly low: number | null;
  readonly high: number | null;
}

export interface LeadRunway extends CampaignLabel {
  /** Leads still active in the campaign. */
  readonly remaining: number;
  readonly dailyContactRate: number | null;
  /** An estimate: `remaining` at the recent daily pace. `0` when no lead is left. */
  readonly daysLeft: number;
}

export interface ActionItem {
  readonly kind:
    | "add_leads"
    | "check_anomaly"
    | "fix_bounces"
    | "reply_rate_fell"
    | "review_campaign";
  /** The campaign's ref, or `null` when the item is about the whole account. */
  readonly campaign: string | null;
  readonly campaignName: string | null;
  readonly action: string;
  /** The number behind the item. */
  readonly number: number | null;
}

export interface ClientReport extends CampaignsRead {
  readonly days: number;
  readonly period: DayRange;
  readonly previousPeriod: DayRange;
  readonly campaigns: number;
  /** Every campaign read, added together: this period, the one before and the change. */
  readonly totals: Comparison;
  /**
   * What `top`, `bottom` and `totals` divide replies by: messages sent in
   * the period, never leads contacted, since a period's replies also answer
   * leads contacted before it.
   */
  readonly replyRateBasis: "sent";
  /** Best campaigns by the low end of the interval of replies per message sent. */
  readonly top: readonly RankedCampaign[];
  /** Worst campaigns, worst first. Never repeats one in `top`. */
  readonly bottom: readonly RankedCampaign[];
  /** Worst first. */
  readonly bounceProblems: readonly BounceProblem[];
  /** Unusual days in the period, workspace-wide. `null` when the adapter cannot serve them. */
  readonly anomalies: readonly Anomaly[] | null;
  /** Active campaigns about to run out of leads, soonest first. `null` when the adapter cannot serve them. */
  readonly runningOutOfLeads: readonly LeadRunway[] | null;
  /** What to do, most pressing first. */
  readonly actions: readonly ActionItem[];
  /** The sections left out because the adapter cannot serve them. */
  readonly leftOut: readonly string[];
}

const bounceProblems = (
  campaigns: readonly CampaignPeriods[],
  options: Options
): BounceProblem[] =>
  campaigns
    .flatMap(({ campaign, current }) => {
      const { count, high, low, of, rate } = ratesOf(current).bounceRate;

      return rate !== null &&
        rate > options.max_bounce_rate &&
        (volumeOf(current) ?? -1) >= options.min_sent
        ? [
            {
              ...labelOf(campaign),
              bounced: count,
              count,
              high,
              low,
              of,
              rate,
              sent: of,
            },
          ]
        : [];
    })
    .toSorted((left, right) => right.rate - left.rate);

const readAnomalies = async (
  context: InsightContext,
  period: DayRange,
  options: Options
): Promise<Anomaly[] | null> => {
  const { capabilities } = context.outbound;

  if (
    capabilities["stats.byDay"] === false ||
    capabilities["stats.workspace"] === false
  ) {
    return null;
  }

  const series = await readDaily(context, null, {
    from: shiftDay(period.from, -options.baseline_days),
    to: period.to,
  });

  return [
    ...findAnomalies(series, {
      baselineDays: options.baseline_days,
      firstDay: period.from,
      metrics: ["sent", "replied", "bounced"],
      minBaselinePoints: options.min_baseline_points,
      threshold: options.anomaly_threshold,
    }).anomalies,
  ];
};

const readRunways = async (
  context: InsightContext,
  campaigns: readonly CampaignPeriods[],
  options: Options
): Promise<LeadRunway[] | null> => {
  const { capabilities } = context.outbound;

  if (
    !capabilities["leads.byCampaign"] ||
    capabilities["stats.byDay"] === false
  ) {
    return null;
  }

  const active = campaigns.flatMap(({ campaign }) =>
    campaign.status === "active" ? [campaign] : []
  );

  const forecasts = await mapConcurrent(active, async (campaign) => ({
    campaign,
    forecast: await forecastCampaign(context, campaign, {
      days: options.days,
      leadsInput: "max_leads_per_campaign",
      leadsWhat: "leads of a campaign",
      maxLeads: options.max_leads_per_campaign,
    }),
  }));

  const runways: LeadRunway[] = forecasts.flatMap(({ campaign, forecast }) =>
    forecast.leadsComplete &&
    forecast.daysLeft !== null &&
    forecast.daysLeft <= options.runway_days
      ? [
          {
            ...labelOf(campaign),
            dailyContactRate: forecast.dailyContactRate,
            daysLeft: forecast.daysLeft,
            remaining: forecast.remaining,
          },
        ]
      : []
  );

  // A campaign with no leads left is first: it has stopped sending already.
  return runways.toSorted((left, right) => left.daysLeft - right.daysLeft);
};

type Sections = Pick<
  ClientReport,
  "anomalies" | "bottom" | "bounceProblems" | "runningOutOfLeads" | "totals"
>;

const actionsOf = (report: Sections): ActionItem[] => {
  const [worst] = report.bottom;
  const { current, previous } = report.totals;

  return [
    ...report.bounceProblems.map((problem) => ({
      action: `Fix the bounces of ${problem.campaignName}: its bounce rate is ${percent(problem.rate)} (${problem.count} of ${problem.of} sends).`,
      campaign: problem.campaign,
      campaignName: problem.campaignName,
      kind: "fix_bounces" as const,
      number: problem.rate,
    })),
    ...(report.runningOutOfLeads ?? []).map((runway) => ({
      action:
        runway.remaining === 0
          ? `Add leads to ${runway.campaignName}: no leads are left to contact, so it is not sending.`
          : `Add leads to ${runway.campaignName}: ${runway.remaining} ${runway.remaining === 1 ? "lead remains" : "leads remain"}, ${sendingLeft(runway.daysLeft)}.`,
      campaign: runway.campaign,
      campaignName: runway.campaignName,
      kind: "add_leads" as const,
      number: runway.daysLeft,
    })),
    ...(report.totals.verdict === "down"
      ? [
          {
            action: `Find out what changed: replies per message sent fell from ${percent(previous.replyRate)} to ${percent(current.replyRate)}, more than chance would give.`,
            campaign: null,
            campaignName: null,
            kind: "reply_rate_fell" as const,
            number: report.totals.change.replyRate,
          },
        ]
      : []),
    ...(worst === undefined
      ? []
      : [
          {
            action: `Review the copy and the audience of ${worst.campaignName}: it has the fewest replies per message sent, ${percent(worst.rate)} (${worst.count} of ${worst.of}).`,
            campaign: worst.campaign,
            campaignName: worst.campaignName,
            kind: "review_campaign" as const,
            number: worst.rate,
          },
        ]),
    ...(report.anomalies ?? []).map((anomaly) => ({
      action: `Check what happened on ${anomaly.date}: ${anomaly.finding}`,
      campaign: null,
      campaignName: null,
      kind: "check_anomaly" as const,
      number: anomaly.value,
    })),
  ];
};

export const clientReport = defineInsight({
  description:
    "One report for one client or workspace over the last `days` complete days: totals and the change from the period before, the best and worst campaigns by the low end of the interval of replies per message sent, campaigns with a bounce problem, unusual days, active campaigns running out of leads, and a short list of action items in plain language, each naming the campaign and the number behind it. Reply rates divide by messages sent (`replyRateBasis`), not leads contacted, since a period's replies also answer leads contacted before it. Use it for a weekly client update. A section the adapter cannot serve is null and named in `leftOut`, and a null count is one the vendor does not report. Costs two stats requests per campaign, one for the workspace, and for each active campaign two more plus its pages of leads.",
  inputSchema: input,
  key: "clientReport",
  name: "client_report",
  needs: ["stats.campaign"],
  next: "Use campaign_diagnosis on a campaign an action item names, with from and to set to this report's `period`, or period_comparison for every campaign's change.",
  run: async (context, options) => {
    const periods = await readPeriods(context, options);

    const ranking = rankCampaigns(
      periods.campaigns.map((entry) => ({
        campaign: entry.campaign,
        counts: entry.current,
      })),
      "reply_rate",
      options.min_sent,
      perMessageBase
    );

    const sections: Sections = {
      anomalies: await readAnomalies(context, periods.current, options),
      bottom: ranking.ranked
        .slice(options.limit)
        .slice(-options.limit)
        .toReversed(),
      bounceProblems: bounceProblems(periods.campaigns, options),
      runningOutOfLeads: await readRunways(context, periods.campaigns, options),
      totals: noted(
        context,
        "Totals",
        totalOf(periods.campaigns, options.alpha)
      ),
    };

    const leftOut = [
      ...(sections.anomalies === null
        ? ["Unusual days: the adapter has no workspace stats by day."]
        : []),
      ...(sections.runningOutOfLeads === null
        ? [
            "Campaigns running out of leads: the adapter cannot list a campaign's leads or has no stats by day.",
          ]
        : []),
    ];

    for (const section of leftOut) {
      context.note(`Left out. ${section}`);
    }

    const report: ClientReport = {
      ...sections,
      ...periods.read,
      actions: actionsOf(sections),
      campaigns: periods.campaigns.length,
      days: options.days,
      leftOut,
      period: periods.current,
      previousPeriod: periods.previous,
      replyRateBasis: "sent",
      top: ranking.ranked.slice(0, options.limit),
    };

    return report;
  },
});
