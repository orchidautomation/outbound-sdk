// client_report: one report for one client or workspace, composed from what
// the other ops insights compute.

import { z } from "zod";

import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { findAnomalies } from "./anomalies.ts";
import type { Anomaly } from "./anomalies.ts";
import { rankCampaigns } from "./campaign-ranking.ts";
import type { RankedCampaign } from "./campaign-ranking.ts";
import { readPeriods, totalOf } from "./period-comparison.ts";
import type { CampaignPeriods, Comparison } from "./period-comparison.ts";
import { forecastCampaign } from "./pipeline-forecast.ts";
import {
  labelOf,
  listFields,
  percent,
  ratesOf,
  readDaily,
  shiftDay,
  volumeOf,
} from "./shared.ts";
import type { CampaignLabel, DayRange } from "./shared.ts";

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
  top: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3)
    .describe("How many best and worst campaigns to show"),
});

type Options = z.infer<typeof input>;

export interface BounceProblem extends CampaignLabel {
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
  /** An estimate: `remaining` at the recent daily pace. */
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

export interface ClientReport {
  readonly days: number;
  readonly period: DayRange;
  readonly previousPeriod: DayRange;
  readonly campaigns: number;
  /** Every campaign read, added together: this period, the one before and the change. */
  readonly totals: Comparison;
  /** Best campaigns by the low end of the reply rate interval. */
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
        ? [{ ...labelOf(campaign), bounced: count, high, low, rate, sent: of }]
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

  const runways: LeadRunway[] = [];

  for (const { campaign } of campaigns) {
    if (campaign.status === "active") {
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      const forecast = await forecastCampaign(context, campaign, {
        days: options.days,
        maxLeads: options.max_leads_per_campaign,
      });

      if (
        forecast.leadsComplete &&
        forecast.daysLeft !== null &&
        forecast.daysLeft <= options.runway_days
      ) {
        runways.push({
          ...labelOf(campaign),
          dailyContactRate: forecast.dailyContactRate,
          daysLeft: forecast.daysLeft,
          remaining: forecast.remaining,
        });
      }
    }
  }

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
      action: `Fix the bounces of ${problem.name}: its bounce rate is ${percent(problem.rate)} (${problem.bounced} of ${problem.sent} sends).`,
      campaign: problem.campaign,
      campaignName: problem.name,
      kind: "fix_bounces" as const,
      number: problem.rate,
    })),
    ...(report.runningOutOfLeads ?? []).map((runway) => ({
      action: `Add leads to ${runway.name}: ${runway.remaining} leads remain, about ${runway.daysLeft} days of sending.`,
      campaign: runway.campaign,
      campaignName: runway.name,
      kind: "add_leads" as const,
      number: runway.daysLeft,
    })),
    ...(report.totals.verdict === "down"
      ? [
          {
            action: `Find out what changed: the reply rate fell from ${percent(previous.replyRate)} to ${percent(current.replyRate)}, more than chance would give.`,
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
            action: `Review the copy and the audience of ${worst.name}: it has the weakest reply rate, ${percent(worst.rate)} (${worst.count} of ${worst.of}).`,
            campaign: worst.campaign,
            campaignName: worst.name,
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
    "One report for one client or workspace over the last `days` complete days: totals and the change from the period before, the best and worst campaigns by the low end of the reply rate interval, campaigns with a bounce problem, unusual days, active campaigns running out of leads, and a short list of action items in plain language, each naming the campaign and the number behind it. Use it for a weekly client update. A section the adapter cannot serve is null and named in `leftOut`, and a null count is one the vendor does not report. Costs two stats requests per campaign, one for the workspace, and for each active campaign two more plus its pages of leads.",
  inputSchema: input,
  key: "clientReport",
  name: "client_report",
  needs: ["stats.campaign"],
  next: "Use campaign_diagnosis on a campaign an action item names, or period_comparison for every campaign's change.",
  run: async (context, options) => {
    const periods = await readPeriods(context, options);

    const ranking = rankCampaigns(
      periods.campaigns.map((entry) => ({
        campaign: entry.campaign,
        counts: entry.current,
      })),
      "reply_rate",
      options.min_sent
    );

    const sections: Sections = {
      anomalies: await readAnomalies(context, periods.current, options),
      bottom: ranking.ranked
        .slice(options.top)
        .slice(-options.top)
        .toReversed(),
      bounceProblems: bounceProblems(periods.campaigns, options),
      runningOutOfLeads: await readRunways(context, periods.campaigns, options),
      totals: totalOf(periods.campaigns, options.alpha),
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
      actions: actionsOf(sections),
      campaigns: periods.campaigns.length,
      days: options.days,
      leftOut,
      period: periods.current,
      previousPeriod: periods.previous,
      top: ranking.ranked.slice(0, options.top),
    };

    return report;
  },
});
