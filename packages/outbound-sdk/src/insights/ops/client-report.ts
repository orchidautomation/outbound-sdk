// client_report: one report for one client or workspace, composed from what
// the other ops insights compute.

import { z } from "zod";

import { OutboundError } from "../../internal/errors.ts";
import { count as formatCount } from "../../internal/numbers.ts";
import { either, readCampaignsIn } from "../capped.ts";
import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { percent } from "../stats.ts";
import { findAnomalies } from "./anomalies.ts";
import type { Anomaly } from "./anomalies.ts";
import { rankCampaigns } from "./campaign-ranking.ts";
import type { RankedCampaign } from "./campaign-ranking.ts";
import { readRunways, runwayActions } from "./client-runway.ts";
import type { ActionItem, LeadRunway } from "./client-runway.ts";
import { notedTotal, readPeriods } from "./period-comparison.ts";
import type { CampaignPeriods, Comparison } from "./period-comparison.ts";
import {
  campaignsBasis,
  labelOf,
  lastDays,
  listFields,
  RATE_WORDS,
  ratesOf,
  readDaily,
  shiftDay,
  toolsLeftOut,
  volumeOf,
} from "./shared.ts";
import type {
  CampaignLabel,
  CountsBasis,
  DayRange,
  ReplyBasis,
  ToolLeftOut,
} from "./shared.ts";
import {
  readManySkipped,
  skippedFields,
  skippedLimits,
} from "./skipped-leads.ts";
import type { SkippedLeads } from "./skipped-leads.ts";

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
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3)
    .describe("How many best and worst campaigns to show"),
  max_bounce_rate: z
    .number()
    .min(0)
    .max(1)
    .default(0.03)
    .describe("A campaign bounce rate over this is a bounce problem"),
  ...skippedFields,
  max_leads_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(5000)
    .describe(
      "The most leads to read per active campaign, for leads left. Only its active leads where the tool lists them alone."
    ),
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
  provider: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Read one tool of a combined instance: its provider (instantly) or provider:workspace. Leave out for every tool."
    ),
  runway_days: z
    .number()
    .min(0)
    .default(7)
    .describe(
      "A campaign with this many days of leads left or fewer is flagged"
    ),
});

type Options = z.infer<typeof input>;

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

export interface ClientReport extends CampaignsRead {
  readonly days: number;
  readonly period: DayRange;
  readonly previousPeriod: DayRange;
  readonly campaigns: number;
  /** Every campaign read, added together: this period, the one before and the change. */
  readonly totals: Comparison;
  /**
   * What `totals` counts: the campaigns read, in the states asked for.
   * Always set by the insight, like `toolsLeftOut` and `stalled`; optional
   * so a value built by hand stays valid.
   */
  readonly totalsBasis?: CountsBasis;
  /**
   * Tools of a combined instance none of whose campaigns is in `statuses`,
   * so `totals` leaves them out, each with its own workspace totals for the
   * period.
   */
  readonly toolsLeftOut?: readonly ToolLeftOut[];
  /**
   * What `top`, `bottom` and `totals` divide replies by: messages sent in
   * the period when both periods report them, since a period's replies also
   * answer leads contacted before it, and otherwise leads contacted.
   */
  readonly replyRateBasis: ReplyBasis;
  /** Best campaigns by the low end of the interval of the reply rate, over `replyRateBasis`. */
  readonly top: readonly RankedCampaign[];
  /** Worst campaigns, worst first. Never repeats one in `top`. */
  readonly bottom: readonly RankedCampaign[];
  /** Worst first. */
  readonly bounceProblems: readonly BounceProblem[];
  /**
   * Campaigns whose skipped leads (loaded, then never sent to by the tool)
   * are over `max_skipped_share` of their leads and at least `min_skipped`,
   * highest share first. `null` when the tool does not count skipped leads.
   * Always set by the insight; optional so a value built by hand stays valid.
   */
  readonly manySkippedLeads?: readonly SkippedLeads[] | null;
  /** Unusual days in the period, workspace-wide. `null` when the adapter cannot serve them. */
  readonly anomalies: readonly Anomaly[] | null;
  /**
   * Active campaigns with no lead left to start, then those whose leads left
   * to start run out within `runway_days`, soonest first. `null` when the
   * adapter cannot serve them.
   */
  readonly runningOutOfLeads: readonly LeadRunway[] | null;
  /**
   * Active campaigns with leads left to start but no new lead started in the
   * period, or no count of leads started. `null` with `runningOutOfLeads`.
   */
  readonly stalled?: readonly LeadRunway[] | null;
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

type Sections = Pick<
  ClientReport,
  | "anomalies"
  | "bottom"
  | "bounceProblems"
  | "manySkippedLeads"
  | "runningOutOfLeads"
  | "stalled"
  | "totals"
>;

const actionsOf = (
  report: Sections,
  options: Pick<Options, "days" | "runway_days">
): ActionItem[] => {
  const [worst] = report.bottom;
  const { current, previous, replyRateBasis } = report.totals;
  const perWhat = RATE_WORDS[replyRateBasis].toLowerCase();

  return [
    ...report.bounceProblems.map((problem) => ({
      action: `Fix the bounces of ${problem.campaignName}: its bounce rate is ${percent(problem.rate)} (${problem.count} of ${problem.of} sends).`,
      campaign: problem.campaign,
      campaignName: problem.campaignName,
      kind: "fix_bounces" as const,
      number: problem.rate,
    })),
    ...(report.manySkippedLeads ?? []).map((campaign) => ({
      action: `Find out why ${campaign.campaignName} skipped ${formatCount(campaign.skipped)} of its ${formatCount(campaign.leads)} leads (${percent(campaign.share)}): check the block list and the campaign's duplicate rules.`,
      campaign: campaign.campaign,
      campaignName: campaign.campaignName,
      kind: "check_skipped_leads" as const,
      number: campaign.skipped,
    })),
    ...(report.totals.verdict === "down"
      ? [
          {
            action: `Find out what changed: ${perWhat} fell from ${percent(previous.replyRate)} to ${percent(current.replyRate)}, more than chance would give.`,
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
            action: `Review the copy and the audience of ${worst.campaignName}: it has the fewest ${perWhat}, ${percent(worst.rate)} (${worst.count} of ${worst.of}).`,
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
    ...runwayActions(
      {
        runningOut: report.runningOutOfLeads ?? [],
        stalled: report.stalled ?? [],
      },
      options
    ),
  ];
};

/** The sections left out because the adapter cannot serve them. */
const leftOutOf = (parts: {
  readonly anomalies: unknown;
  readonly runways: unknown;
  readonly skipped: unknown;
  readonly scoped: boolean;
}): string[] => [
  ...(parts.anomalies === null
    ? [
        parts.scoped
          ? "Unusual days: they are workspace-wide, so a campaign scope leaves them out."
          : "Unusual days: the adapter has no workspace stats by day.",
      ]
    : []),
  ...(parts.runways === null
    ? [
        "Campaigns running out of leads: the adapter cannot list a campaign's leads or has no stats by day.",
      ]
    : []),
  ...(parts.skipped === null
    ? [
        "Campaigns with many skipped leads: the adapter does not report how many of a campaign's leads were skipped.",
      ]
    : []),
];

/**
 * The context narrowed to the tool `provider` names: a provider, or a
 * `provider:workspace` label. Refuses a name no tool has before any request.
 */
const scopedTo = async (
  context: InsightContext,
  provider: string | undefined
): Promise<InsightContext> => {
  if (provider === undefined) {
    return context;
  }

  const { outbound } = context;

  if (outbound.provider !== "combined") {
    if (
      provider === outbound.provider ||
      provider === `${outbound.provider}:${outbound.workspaceId}`
    ) {
      return context;
    }

    throw new OutboundError(
      "Invalid",
      `client_report: provider ${provider} is not this instance's tool, ${outbound.provider}:${outbound.workspaceId}`,
      { provider: outbound.provider }
    );
  }

  // A combined instance lists its tools with no request.
  const { items } = await outbound.workspaces.list();
  const labels = items.map((tool) => `${tool.provider}:${tool.workspaceId}`);

  const matches = labels.filter(
    (label) => label === provider || label.startsWith(`${provider}:`)
  );

  const [only] = matches;

  if (only === undefined || matches.length > 1) {
    throw new OutboundError(
      "Invalid",
      `client_report: provider ${provider} ${only === undefined ? "names no tool" : "names more than one tool"} of this instance. Pass one of ${either(labels)}.`,
      { provider: outbound.provider }
    );
  }

  return { ...context, outbound: outbound.workspace(only) };
};

export const clientReport = defineInsight({
  description:
    "One report for one client or workspace over the last `days` complete days, in one call: totals and the change from the period before, the best and worst campaigns by reply rate, bounce problems, unusual days, every active campaign out of leads or running out within runway_days (7 by default), stalled ones, campaigns with many skipped leads, and action items naming the campaign and the number behind it. On a combined instance it reads every tool and names one it left out in toolsLeftOut; a provider or campaign scope narrows it. Costs about 9 requests per active campaign on Instantly.",
  inputSchema: input,
  key: "clientReport",
  cost: (values, price) => {
    const { capabilities } = price;
    const campaigns = price.campaigns(values.max_campaigns);
    const byDay = capabilities["stats.byDay"] !== false;

    return (
      price.campaignsIn(new Set(values.statuses).size, values.max_campaigns) +
      2 * campaigns * price.one("stats") +
      (byDay && capabilities["stats.workspace"] !== false
        ? price.one("stats")
        : 0) +
      (byDay && capabilities["leads.byCampaign"] !== false
        ? price.upTo(campaigns) *
          (price.list("leads.list", values.max_leads_per_campaign) +
            price.one("stats"))
        : 0) +
      // Each campaign's progress, where the tool counts its skipped leads.
      (capabilities["campaigns.progress"] === false
        ? 0
        : price.upTo(campaigns) * price.one("campaigns.progress"))
    );
  },
  scales: "max_campaigns",
  name: "client_report",
  needs: ["stats.campaign"],
  partialOnCap: true,
  next: "Use campaign_diagnosis on a campaign an action item names, with from and to set to this report's `period`, or period_comparison for every campaign's change.",
  run: async (given, options) => {
    const context = await scopedTo(given, options.provider);
    const scoped = given.scope !== null;

    const listed = await readCampaignsIn(
      context,
      options.statuses,
      options.max_campaigns
    );

    // Read before the campaigns, so a request cap that stops them part way leaves the unusual days in the report. They are workspace-wide, so a campaign scope leaves them out.
    const anomalies = scoped
      ? null
      : await readAnomalies(
          context,
          lastDays(context.now, options.days),
          options
        );

    const periods = await readPeriods(context, listed, options.days);

    const left = await toolsLeftOut(context, listed.skipped, periods.current);

    const totals = notedTotal(context, periods.campaigns, options.alpha);

    // Campaigns are ranked on the base the totals use.
    const ranking = rankCampaigns(
      periods.campaigns.map((entry) => ({
        campaign: entry.campaign,
        counts: entry.current,
      })),
      "reply_rate",
      options.min_sent,
      totals.replyRateBasis
    );

    const runways = await readRunways(context, periods.campaigns, options);

    const manySkippedLeads = await readManySkipped(
      context,
      periods.campaigns.map((entry) => entry.campaign),
      skippedLimits(options)
    );

    const sections: Sections = {
      anomalies,
      bottom: ranking.ranked
        .slice(options.limit)
        .slice(-options.limit)
        .toReversed(),
      bounceProblems: bounceProblems(periods.campaigns, options),
      manySkippedLeads,
      runningOutOfLeads: runways?.runningOut ?? null,
      stalled: runways?.stalled ?? null,
      totals,
    };

    const leftOut = leftOutOf({
      anomalies: sections.anomalies,
      runways,
      skipped: manySkippedLeads,
      scoped,
    });

    for (const section of leftOut) {
      context.note(`Left out. ${section}`);
    }

    const report: ClientReport = {
      ...sections,
      ...periods.read,
      actions: actionsOf(sections, options),
      campaigns: periods.campaigns.length,
      days: options.days,
      leftOut,
      period: periods.current,
      previousPeriod: periods.previous,
      replyRateBasis: totals.replyRateBasis,
      toolsLeftOut: left,
      top: ranking.ranked.slice(0, options.limit),
      totalsBasis: campaignsBasis(periods.campaigns.length, options.statuses),
    };

    return report;
  },
});
