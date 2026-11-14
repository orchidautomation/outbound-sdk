// settings_audit: risky campaign settings.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type {
  CampaignSettings,
  SendingWindow,
} from "../../internal/entities-account.ts";
import type { Campaign } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import {
  dayFrom,
  readCampaigns,
  readCampaignSenders,
  statusesInput,
} from "./read.ts";

const input = z.object({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe(
      "The most campaigns to audit. Each costs 1 request, or 2 when its senders can be listed."
    ),
  max_daily_limit_per_sender: z
    .number()
    .min(1)
    .default(50)
    .describe(
      "A campaign's daily limit should not exceed this many sends per attached sender"
    ),
  max_senders_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("The most senders to count for one campaign"),
  max_window_hours: z
    .number()
    .min(1)
    .max(24)
    .default(12)
    .describe("A sending window longer than this many hours is flagged"),
  min_gap_minutes: z
    .number()
    .min(0)
    .default(5)
    .describe("A wait between two sends shorter than this is flagged"),
  min_window_hours: z
    .number()
    .min(0)
    .max(24)
    .default(2)
    .describe("A sending window shorter than this many hours is flagged"),
  statuses: statusesInput,
});

export type SettingsCheck =
  | "click_tracking"
  | "end_date_passed"
  | "gap_short"
  | "limit_over_senders"
  | "no_daily_limit"
  | "no_timezone"
  | "no_window"
  | "open_tracking"
  | "reply_does_not_stop"
  | "weekend"
  | "window_long"
  | "window_short";

export type SettingsSeverity = "high" | "low" | "medium";

export interface SettingsFinding {
  readonly check: SettingsCheck;
  readonly severity: SettingsSeverity;
  readonly finding: string;
  /** The setting's value behind the finding, when it has one. */
  readonly value: number | string | null;
}

export interface AuditedCampaign {
  readonly campaign: string;
  readonly name: string;
  readonly status: string;
  /** Most serious first. */
  readonly findings: readonly SettingsFinding[];
}

export type SettingsCheckCounts = Readonly<Record<SettingsCheck, number>>;

export interface SettingsAudit {
  /** Campaigns with at least one finding, the one with the most serious findings first. */
  readonly campaigns: readonly AuditedCampaign[];
  /** How many campaigns each check flagged. */
  readonly byCheck: SettingsCheckCounts;
  readonly totals: {
    readonly campaigns: number;
    readonly withFindings: number;
    readonly clean: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
}

interface Bars {
  readonly maxPerSender: number;
  readonly maxWindowHours: number;
  readonly minGapMinutes: number;
  readonly minWindowHours: number;
}

interface Audit {
  readonly campaign: Campaign;
  readonly settings: CampaignSettings;
  /** `null` when the campaign's senders could not be listed. */
  readonly senders: number | null;
  readonly today: string;
  readonly bars: Bars;
}

const SEVERITY: Readonly<Record<SettingsCheck, SettingsSeverity>> = {
  click_tracking: "medium",
  end_date_passed: "high",
  gap_short: "medium",
  limit_over_senders: "high",
  no_daily_limit: "medium",
  no_timezone: "low",
  no_window: "medium",
  open_tracking: "medium",
  reply_does_not_stop: "high",
  weekend: "low",
  window_long: "medium",
  window_short: "low",
};

const ORDER: readonly SettingsSeverity[] = ["high", "medium", "low"];

const when = (
  hit: boolean,
  check: SettingsCheck,
  finding: string,
  value: number | string | null = null
): SettingsFinding[] =>
  hit ? [{ check, finding, severity: SEVERITY[check], value }] : [];

const minutesOf = (clock: string): number =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

/** A window's length in hours. One that ends before it starts runs past midnight. */
const hoursOf = (window: SendingWindow): number | null => {
  if (window.from === null || window.to === null) {
    return null;
  }

  const minutes = minutesOf(window.to) - minutesOf(window.from);

  return (
    Math.round(((minutes > 0 ? minutes : minutes + 1440) / 60) * 100) / 100
  );
};

const scheduleFindings = ({ bars, settings }: Audit): SettingsFinding[] => {
  const { schedule } = settings;

  if (schedule.length === 0) {
    return when(
      true,
      "no_window",
      "No sending window is set or reported, so it can send at any hour."
    );
  }

  // A window with no reported hours is left out of the length checks.
  const hours = schedule.flatMap((window) => hoursOf(window) ?? []);
  const longest = Math.max(...hours);
  const shortest = Math.min(...hours);

  const weekend = schedule.find(
    (window) => window.days.includes(0) || window.days.includes(6)
  );

  return [
    ...when(
      weekend !== undefined,
      "weekend",
      "A sending window includes Saturday or Sunday.",
      weekend?.days.join(",")
    ),
    ...when(
      longest > bars.maxWindowHours,
      "window_long",
      `A sending window is ${longest} hours long, over ${bars.maxWindowHours}.`,
      longest
    ),
    ...when(
      shortest < bars.minWindowHours,
      "window_short",
      `A sending window is ${shortest} hours long, under ${bars.minWindowHours}.`,
      shortest
    ),
    ...when(
      schedule.some((window) => window.timezone === null),
      "no_timezone",
      "A sending window has no timezone."
    ),
  ];
};

const limitFindings = (audit: Audit): SettingsFinding[] => {
  const { bars, campaign, senders, settings, today } = audit;
  const { dailyLimit, endDate, gapMinutes } = settings;
  // With no sender attached there is nothing to compare the limit with.
  const allowed = (senders ?? 0) * bars.maxPerSender;

  return [
    ...when(
      dailyLimit === null,
      "no_daily_limit",
      "No daily limit is set or reported."
    ),
    ...when(
      dailyLimit !== null && allowed > 0 && dailyLimit > allowed,
      "limit_over_senders",
      `The daily limit of ${dailyLimit} is over ${bars.maxPerSender} a day for each of its ${senders} senders (${allowed}).`,
      dailyLimit
    ),
    ...when(
      gapMinutes !== null && gapMinutes < bars.minGapMinutes,
      "gap_short",
      `Sends are ${gapMinutes} minutes apart, under ${bars.minGapMinutes}.`,
      gapMinutes
    ),
    ...when(
      campaign.status === "active" && endDate !== null && endDate < today,
      "end_date_passed",
      `The campaign is active but its end date ${endDate} has passed.`,
      endDate
    ),
  ];
};

const ruleFindings = ({ settings }: Audit): SettingsFinding[] => [
  ...when(
    settings.stopOnReply === false,
    "reply_does_not_stop",
    "A lead who replies keeps getting the next steps."
  ),
  ...when(
    settings.tracking.opens === true,
    "open_tracking",
    "Open tracking is on, a deliverability risk."
  ),
  ...when(
    settings.tracking.clicks === true,
    "click_tracking",
    "Click tracking is on; it rewrites links, a deliverability risk."
  ),
];

const audit = (subject: Audit): AuditedCampaign => ({
  campaign: subject.campaign.ref,
  findings: [
    ...scheduleFindings(subject),
    ...limitFindings(subject),
    ...ruleFindings(subject),
  ].toSorted(
    (left, right) =>
      ORDER.indexOf(left.severity) - ORDER.indexOf(right.severity)
  ),
  name: subject.campaign.name,
  status: subject.campaign.status,
});

const countOf = (campaign: AuditedCampaign, severity: SettingsSeverity) =>
  campaign.findings.filter((finding) => finding.severity === severity).length;

const worstFirst = (left: AuditedCampaign, right: AuditedCampaign): number =>
  countOf(right, "high") - countOf(left, "high") ||
  countOf(right, "medium") - countOf(left, "medium") ||
  right.findings.length - left.findings.length;

const countChecks = (
  campaigns: readonly AuditedCampaign[]
): SettingsCheckCounts => {
  const count = (check: SettingsCheck): number =>
    campaigns.filter((campaign) =>
      campaign.findings.some((finding) => finding.check === check)
    ).length;

  return {
    click_tracking: count("click_tracking"),
    end_date_passed: count("end_date_passed"),
    gap_short: count("gap_short"),
    limit_over_senders: count("limit_over_senders"),
    no_daily_limit: count("no_daily_limit"),
    no_timezone: count("no_timezone"),
    no_window: count("no_window"),
    open_tracking: count("open_tracking"),
    reply_does_not_stop: count("reply_does_not_stop"),
    weekend: count("weekend"),
    window_long: count("window_long"),
    window_short: count("window_short"),
  };
};

export const settingsAudit = defineInsight({
  description:
    "Risky campaign settings, per campaign and by severity: no sending window, a window that includes the weekend or is too long or too short, no timezone, open or click tracking on, a reply that does not stop the sequence, no daily limit, sends too close together, an end date in the past on an active campaign, and a daily limit too high for the number of senders. Returns the findings per campaign, worst first, and a count per check. Use it before launching a campaign or when deliverability drops. Costs one listing of campaigns, then 1 request per campaign, or 2 when its senders can be listed. A setting the vendor reports nothing for is skipped, except a missing window, timezone or daily limit, which the vendor cannot tell apart from one that is not set.",
  inputSchema: input,
  key: "settingsAudit",
  name: "settings_audit",
  needs: ["campaigns.settings"],
  next: "Use sender_capacity to size a daily limit against the senders, or bounce_watch to see whether a flagged campaign already bounces.",
  run: async (context, options) => {
    const { outbound } = context;
    const countSenders = outbound.capabilities["senders.byCampaign"];

    const bars: Bars = {
      maxPerSender: options.max_daily_limit_per_sender,
      maxWindowHours: options.max_window_hours,
      minGapMinutes: options.min_gap_minutes,
      minWindowHours: options.min_window_hours,
    };

    const campaigns = await readCampaigns(
      context,
      options.statuses,
      options.max_campaigns
    );

    if (!countSenders) {
      context.note(
        "The daily limit was not compared with the sender count: the adapter cannot list a campaign's senders."
      );
    }

    const audited: AuditedCampaign[] = await mapConcurrent(
      campaigns,
      async (campaign) => {
        const [settings, senders] = await Promise.all([
          outbound.campaign(campaign.ref).settings(),
          countSenders
            ? readCampaignSenders(
                context,
                campaign,
                options.max_senders_per_campaign
              )
            : null,
        ]);

        return audit({
          bars,
          campaign,
          senders: senders?.length ?? null,
          settings: context.one(settings),
          today: dayFrom(context.now, 0),
        });
      }
    );

    const flagged = audited
      .filter((campaign) => campaign.findings.length > 0)
      .toSorted(worstFirst);

    const sum = (severity: SettingsSeverity): number =>
      flagged.reduce((all, campaign) => all + countOf(campaign, severity), 0);

    const answer: SettingsAudit = {
      byCheck: countChecks(flagged),
      campaigns: flagged,
      totals: {
        campaigns: audited.length,
        clean: audited.length - flagged.length,
        high: sum("high"),
        low: sum("low"),
        medium: sum("medium"),
        withFindings: flagged.length,
      },
    };

    return answer;
  },
});
