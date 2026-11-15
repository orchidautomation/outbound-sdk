// The checks behind campaign_diagnosis. Each looks at what was read about one
// campaign and returns the findings it can stand behind, with their numbers.

import type { CampaignSettings } from "../../internal/entities-account.ts";
import type { Campaign, Sender } from "../../internal/entities.ts";
import { noun, plural } from "../../internal/plural.ts";
import { percent, round, spoken } from "../stats.ts";
import { measure, volumeOf } from "./shared.ts";
import type { Rates, Totals } from "./shared.ts";

export type DiagnosisCode =
  | "falling_sends"
  | "few_positive_replies"
  | "high_bounce_rate"
  | "inactive_sender"
  | "low_reply_rate"
  | "no_recent_sends"
  | "schedule_limits_volume"
  | "short_sequence"
  | "too_little_volume"
  | "tracking_off";

export interface DiagnosisFinding {
  readonly code: DiagnosisCode;
  readonly severity: "high" | "low" | "medium";
  readonly finding: string;
  /** The numbers the finding rests on. `null` is one the vendor does not report. */
  readonly numbers: Readonly<Record<string, number | null>>;
  /** What to look at next. */
  readonly next: string;
}

export interface RecentSends {
  /** How many days each window covers. */
  readonly days: number;
  /** Messages sent in the last `days`. `null` when the vendor reports none. */
  readonly sent: number | null;
  /** Messages sent in the `days` before those. */
  readonly before: number | null;
  /** Days in the recent window the vendor reports a send count for. */
  readonly daysWithData: number;
}

/** What was read about the campaign. A part that could not be read is `null`. */
export interface Facts {
  readonly campaign: Campaign;
  readonly totals: Totals;
  readonly opened: number | null;
  readonly rates: Rates;
  readonly settings: CampaignSettings | null;
  /** Steps in the main sequence. */
  readonly steps: number | null;
  readonly senders: readonly Sender[] | null;
  readonly recent: RecentSends | null;
}

export interface Limits {
  readonly minReplyRate: number;
  readonly maxBounceRate: number;
  readonly minSent: number;
  readonly minPositiveShare: number;
  readonly maxSendDrop: number;
  readonly minWeeklyHours: number;
  readonly dailyLimitShare: number;
}

type Check = (facts: Facts, limits: Limits) => DiagnosisFinding[];

const enough = (facts: Facts, limits: Limits): boolean =>
  (volumeOf(facts.totals) ?? -1) >= limits.minSent;

const volume: Check = (facts, limits) => {
  const sent = volumeOf(facts.totals);

  return enough(facts, limits)
    ? []
    : [
        {
          code: "too_little_volume",
          finding:
            sent === null
              ? "The vendor reports no sends for this period, so no rate can be judged."
              : `Only ${sent} sends, under the ${limits.minSent} needed to judge a rate; reply and bounce rates are not assessed.`,
          next: "Let the campaign run longer, or widen the date range.",
          numbers: { minSent: limits.minSent, sent },
          severity: "medium",
        },
      ];
};

const bounces: Check = (facts, limits) => {
  const { count, high, low, of, rate } = facts.rates.bounceRate;

  return !enough(facts, limits) || rate === null || rate <= limits.maxBounceRate
    ? []
    : [
        {
          code: "high_bounce_rate",
          finding: `Bounce rate is ${percent(rate)} (${count} of ${of} sends), over the ${percent(limits.maxBounceRate)} limit.`,
          next: "Use bounce_watch to find the senders behind it, and verify the lead list.",
          numbers: {
            bounced: count,
            high,
            limit: limits.maxBounceRate,
            low,
            rate,
            sent: of,
          },
          severity: "high",
        },
      ];
};

const replies: Check = (facts, limits) => {
  const { count, high, low, of, rate } = facts.rates.replyRate;

  if (!enough(facts, limits) || rate === null || rate >= limits.minReplyRate) {
    return [];
  }

  const clearly = high !== null && high < limits.minReplyRate;

  return [
    {
      code: "low_reply_rate",
      finding: `Reply rate is ${percent(rate)} (${count} of ${of}), under the ${percent(limits.minReplyRate)} floor. The 95% interval is ${percent(low)} to ${percent(high)}, ${
        clearly
          ? "so it is below the floor beyond chance"
          : "which still reaches the floor, so more sends are needed to be sure"
      }.`,
      next: "Use step_funnel and copy_audit to see where replies are lost.",
      numbers: {
        floor: limits.minReplyRate,
        high,
        low,
        rate,
        replied: count,
        sample: of,
      },
      severity: clearly ? "high" : "medium",
    },
  ];
};

const positives: Check = (facts, limits) => {
  const share = measure(facts.totals.positive, facts.totals.replied);

  return !enough(facts, limits) ||
    share.rate === null ||
    share.rate >= limits.minPositiveShare
    ? []
    : [
        {
          code: "few_positive_replies",
          finding: `Only ${share.count} of ${share.of} replies (${percent(share.rate)}) are positive, under the ${percent(limits.minPositiveShare)} expected. With ${share.of} replies the 95% interval is ${percent(share.low)} to ${percent(share.high)}.`,
          next: "Read the replies: the offer or the audience may be off.",
          numbers: {
            high: share.high,
            limit: limits.minPositiveShare,
            low: share.low,
            positive: share.count,
            sample: share.of,
            share: share.rate,
          },
          severity: "medium",
        },
      ];
};

const recentSends: Check = (facts, limits) => {
  const { recent } = facts;

  if (recent === null) {
    return [];
  }

  if (recent.sent === null || recent.sent === 0) {
    return facts.campaign.status === "active"
      ? [
          {
            code: "no_recent_sends",
            finding: `The campaign is active but the vendor reports no sends in the last ${recent.days} days.`,
            next: "Check its senders and schedule, and whether leads remain (pipeline_forecast).",
            numbers: { days: recent.days, sent: recent.sent },
            severity: "high",
          },
        ]
      : [];
  }

  const drop =
    recent.before === null || recent.before <= 0
      ? null
      : round(1 - recent.sent / recent.before);

  return drop === null || drop <= limits.maxSendDrop
    ? []
    : [
        {
          code: "falling_sends",
          finding: `Sends fell from ${recent.before} to ${recent.sent} over the last ${recent.days} days against the ${recent.days} before, a drop of ${percent(drop)}.`,
          next: "Use pipeline_forecast to check the leads left, and sender_capacity for the mailboxes.",
          numbers: { before: recent.before, drop, sent: recent.sent },
          severity: "medium",
        },
      ];
};

const sequence: Check = ({ steps }) =>
  steps === null || steps < 1 || steps > 2
    ? []
    : [
        {
          code: "short_sequence",
          finding: `The sequence has ${steps} ${steps === 1 ? "step" : "steps"}; follow-ups usually bring a large share of the replies.`,
          next: "Add follow-up steps; step_funnel shows what each step earns.",
          numbers: { steps },
          severity: "medium",
        },
      ];

const senders: Check = (facts) => {
  const all = facts.senders ?? [];
  const inactive = all.filter((sender) => sender.status !== "active");

  return inactive.length === 0
    ? []
    : [
        {
          code: "inactive_sender",
          finding: `${inactive.length} of ${plural(all.length, "sender")} ${noun(inactive.length, "is", "are")} not active: ${inactive
            .map(
              (sender) =>
                `${sender.address ?? sender.name ?? sender.ref} (${sender.status})`
            )
            .join(", ")}.`,
          next: "Reconnect or replace them; warmup_readiness shows which mailboxes are fit to send.",
          numbers: { inactive: inactive.length, senders: all.length },
          severity: "high",
        },
      ];
};

const tracking: Check = ({ opened, settings }) =>
  settings?.tracking.opens === false && (opened ?? 0) === 0
    ? [
        {
          code: "tracking_off",
          finding:
            "Open tracking is off, so the missing open count is expected and not a fault.",
          next: "Judge this campaign on replies, not opens.",
          numbers: { opened },
          severity: "low",
        },
      ]
    : [];

const minutesOf = (clock: string | null): number | null => {
  const [hours, minutes] = (clock ?? "").split(":").map(Number);

  return hours === undefined || minutes === undefined
    ? null
    : hours * 60 + minutes;
};

/** Hours a week the sending windows are open. `null` when there is no window or one has no times. */
const weeklyHours = (settings: CampaignSettings): number | null => {
  let minutes = 0;

  for (const window of settings.schedule) {
    const from = minutesOf(window.from);
    const to = minutesOf(window.to);

    if (from === null || to === null || to <= from) {
      return null;
    }

    minutes += (to - from) * window.days.length;
  }

  return settings.schedule.length === 0 ? null : round(minutes / 60);
};

const schedule: Check = ({ recent, settings }, limits) => {
  if (settings === null) {
    return [];
  }

  const hours = weeklyHours(settings);

  const average =
    recent === null || recent.sent === null || recent.daysWithData === 0
      ? null
      : round(recent.sent / recent.daysWithData);

  const reasons = [
    ...(hours !== null && hours < limits.minWeeklyHours
      ? [
          `The sending windows are open ${spoken(hours)} hours a week, under ${limits.minWeeklyHours}.`,
        ]
      : []),
    ...(settings.dailyLimit !== null &&
    average !== null &&
    average >= settings.dailyLimit * limits.dailyLimitShare
      ? [
          `Recent sending days average ${spoken(average)} sends against a daily limit of ${settings.dailyLimit}, so the limit is what holds volume back.`,
        ]
      : []),
  ];

  return reasons.length === 0
    ? []
    : [
        {
          code: "schedule_limits_volume",
          finding: reasons.join(" "),
          next: "Use settings_audit to review the schedule and the limits.",
          numbers: {
            averageDailySent: average,
            dailyLimit: settings.dailyLimit,
            weeklyHours: hours,
          },
          severity: "low",
        },
      ];
};

const CHECKS: readonly Check[] = [
  bounces,
  recentSends,
  senders,
  replies,
  volume,
  positives,
  sequence,
  schedule,
  tracking,
];

const SEVERITY = { high: 0, low: 2, medium: 1 } as const;

/** Every finding, most serious first. */
export const diagnose = (facts: Facts, limits: Limits): DiagnosisFinding[] =>
  CHECKS.flatMap((check) => check(facts, limits)).toSorted(
    (left, right) => SEVERITY[left.severity] - SEVERITY[right.severity]
  );

/** Rates that could not be judged because the vendor reports no count for them. */
export const unknownRates = (facts: Facts): string[] => [
  ...(facts.rates.replyRate.rate === null
    ? ["Reply rate: the vendor reports no reply or volume count."]
    : []),
  ...(facts.rates.bounceRate.rate === null
    ? ["Bounce rate: the vendor reports no bounce or send count."]
    : []),
  ...(facts.totals.positive === null
    ? ["Positive replies: the vendor reports no positive reply count."]
    : []),
];
