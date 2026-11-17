// The checks behind campaign_diagnosis. Each looks at what was read about one
// campaign and returns the findings it can stand behind, with their numbers.

import type { CampaignSettings } from "../../internal/entities-account.ts";
import type { Campaign, Sender } from "../../internal/entities.ts";
import {
  CONTACTED_LEADS_LIMIT,
  contactedBeyondLeads,
} from "../../internal/metrics.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import { warmupAtZero } from "../../internal/sender-screen.ts";
import { percent, round, spoken } from "../stats.ts";
import { measure, volumeOf } from "./shared.ts";
import type { Rates, Totals } from "./shared.ts";

export type DiagnosisCode =
  | "contacted_exceeds_leads"
  | "falling_sends"
  | "few_positive_replies"
  | "high_bounce_rate"
  | "inactive_sender"
  | "low_reply_rate"
  | "no_recent_sends"
  | "out_of_leads"
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
  /** New leads started per day in the last `days`. `null` when the vendor reports no daily contacted count. */
  readonly startedPerDay: number | null;
}

/** The campaign's leads, read only when its sends fell or stopped. */
export interface LeadsLeft {
  /** Active leads: not replied, bounced, unsubscribed, paused or finished. */
  readonly active: number;
  /** Active leads whose sequence has not started, or every active lead when the vendor does not say. */
  readonly toStart: number;
  /** Active leads partway through the sequence. `null` when the vendor does not say. */
  readonly inSequence: number | null;
  /** Days until no lead is left to start, at `startedPerDay`. `null` when it cannot be known. */
  readonly daysLeft: number | null;
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
  /** Read only when sends fell or stopped, every lead was read and the vendor listed some. */
  readonly leads: LeadsLeft | null;
  /** Every lead in the campaign, from its progress. `null` when not read. */
  readonly campaignLeads: number | null;
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
          next: "Verify the lead list. Use bounce_watch to find the senders behind it.",
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
      next: "Use step_funnel to see which step loses replies. Use copy_audit to check the copy.",
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

/** Under a day of leads left to start: the cause of a fall in sends, not a fault. */
const RUNNING_OUT_DAYS = 1;

/** The share sends fell by, recent days against the days before. `null` when it cannot be worked out. */
const dropOf = (recent: RecentSends): number | null =>
  recent.sent === null || recent.before === null || recent.before <= 0
    ? null
    : round(1 - recent.sent / recent.before);

/** Whether the recent sends fell or stopped enough to be a finding, so the leads left are worth reading. */
export const sendsFellOrStopped = (
  campaign: Campaign,
  recent: RecentSends | null,
  limits: Pick<Limits, "maxSendDrop">
): boolean => {
  if (recent === null) {
    return false;
  }

  if (recent.sent === null || recent.sent === 0) {
    return campaign.status === "active";
  }

  const drop = dropOf(recent);

  return drop !== null && drop > limits.maxSendDrop;
};

const runningOut = (leads: LeadsLeft | null): leads is LeadsLeft =>
  leads !== null &&
  leads.daysLeft !== null &&
  leads.daysLeft < RUNNING_OUT_DAYS;

const outOfLeads = (
  recent: RecentSends,
  leads: LeadsLeft
): DiagnosisFinding => {
  const left =
    leads.toStart === 0
      ? "no lead is left to start"
      : `only ${plural(leads.toStart, "lead")} ${noun(leads.toStart, "is", "are")} left to start, under a day at the recent pace of ${spoken(recent.startedPerDay)} new ${noun(recent.startedPerDay ?? 0, "lead", "leads")} a day`;

  const fell =
    recent.sent === null || recent.sent === 0
      ? `The vendor reports no sends in the last ${recent.days} days`
      : `Sends fell from ${recent.before} to ${recent.sent} over the last ${recent.days} days against the ${recent.days} before`;

  const finishing =
    leads.inSequence === null || leads.inSequence === 0
      ? ""
      : ` ${plural(leads.inSequence, "lead")} ${noun(leads.inSequence, "is", "are")} still finishing the sequence.`;

  return {
    code: "out_of_leads",
    finding: `${fell} because the campaign is running out of leads: ${left}.${finishing} This is lead runout, not a sending fault.`,
    next: "Add leads to keep the campaign sending. pipeline_forecast shows what the leads left should produce.",
    numbers: {
      activeLeads: leads.active,
      before: recent.before,
      daysLeft: leads.daysLeft,
      drop: dropOf(recent),
      inSequence: leads.inSequence,
      leadsToStart: leads.toStart,
      newLeadsPerDay: recent.startedPerDay,
      sent: recent.sent,
    },
    severity: "high",
  };
};

const recentSends: Check = (facts, limits) => {
  const { leads, recent } = facts;

  if (recent === null || !sendsFellOrStopped(facts.campaign, recent, limits)) {
    return [];
  }

  if (runningOut(leads)) {
    return [outOfLeads(recent, leads)];
  }

  if (recent.sent === null || recent.sent === 0) {
    return facts.campaign.status === "active"
      ? [
          {
            code: "no_recent_sends",
            finding: `The campaign is active but the vendor reports no sends in the last ${recent.days} days.`,
            next: "Check its senders, its schedule and whether leads remain. pipeline_forecast shows the leads left.",
            numbers: { days: recent.days, sent: recent.sent },
            severity: "high",
          },
        ]
      : [];
  }

  const drop = dropOf(recent);

  return [
    {
      code: "falling_sends",
      finding: `Sends fell from ${recent.before} to ${recent.sent} over the last ${recent.days} days against the ${recent.days} before, a drop of ${percent(drop)}.`,
      next: "Use pipeline_forecast to check the leads left. Use sender_capacity for the mailboxes.",
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
          next: "Add follow-up steps. step_funnel shows what each step earns.",
          numbers: { steps },
          severity: "medium",
        },
      ];

/** Why a sender is flagged: its status when not active, and a warmup score of 0. */
const senderProblems = (sender: Sender): string[] => [
  ...(sender.status === "active" ? [] : [sender.status]),
  ...(warmupAtZero(sender) ? ["warmup score 0"] : []),
];

const senders: Check = (facts) => {
  const all = facts.senders ?? [];

  const flagged = all.flatMap((sender) => {
    const problems = senderProblems(sender);

    return problems.length === 0 ? [] : [{ problems, sender }];
  });

  const inactive = flagged.filter(({ sender }) => sender.status !== "active");
  const warmupZero = all.filter(warmupAtZero).length;
  const what = warmupZero === 0 ? "not active" : "not fit to send";

  return flagged.length === 0
    ? []
    : [
        {
          code: "inactive_sender",
          finding: `${flagged.length} of ${plural(all.length, "sender")} ${noun(flagged.length, "is", "are")} ${what}: ${flagged
            .map(
              ({ problems, sender }) =>
                `${sender.address ?? sender.name ?? sender.ref} (${problems.join(", ")})`
            )
            .join(", ")}.`,
          next: "Reconnect or replace them; warmup_readiness shows which mailboxes are fit to send.",
          numbers: {
            inactive: inactive.length,
            senders: all.length,
            warmupZero,
          },
          severity: "high",
        },
      ];
};

/** What `tracking_off` says, by which tracking is off: the finding, then what to do next. */
const TRACKING_OFF = {
  both: [
    "Open and click tracking are off, so missing open and click counts are expected and not a fault.",
    "Judge this campaign on replies, not opens or clicks.",
  ],
  clicks: [
    "Click tracking is off, so no link click is counted; that is expected and not a fault.",
    "Judge this campaign on replies, not clicks.",
  ],
  opens: [
    "Open tracking is off, so the missing open count is expected and not a fault.",
    "Judge this campaign on replies, not opens.",
  ],
} as const;

const offWhich = (
  opens: boolean,
  clicks: boolean
): keyof typeof TRACKING_OFF => {
  if (opens && clicks) {
    return "both";
  }

  return opens ? "opens" : "clicks";
};

const tracking: Check = ({ opened, settings }) => {
  const opens = settings?.tracking.opens === false && (opened ?? 0) === 0;
  const clicks = settings?.tracking.clicks === false;

  if (!opens && !clicks) {
    return [];
  }

  const [finding, next] = TRACKING_OFF[offWhich(opens, clicks)];

  return [
    {
      code: "tracking_off",
      finding,
      next,
      numbers: { opened },
      severity: "low",
    },
  ];
};

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

// A count of leads contacted far over the campaign's leads cannot be unique
// leads, so the adapter is reading the wrong count and every per-lead rate
// is off. See CONTACTED_LEADS_LIMIT for why a little over is not a fault.
const contactedLeads: Check = ({
  campaignLeads: leads,
  totals: { contacted },
}) =>
  contacted !== null && leads !== null && contactedBeyondLeads(contacted, leads)
    ? [
        {
          code: "contacted_exceeds_leads",
          finding: `The vendor reports ${contacted} leads contacted against ${plural(leads, "lead")} in the campaign, more than ${CONTACTED_LEADS_LIMIT} times as many. Leads contacted cannot be that far over the leads, so that count is not unique leads and the per-lead rates are not to be trusted.`,
          next: "Report it as an adapter fault, and judge the campaign on sends until it is fixed.",
          numbers: { contacted, leads, limit: CONTACTED_LEADS_LIMIT },
          severity: "high",
        },
      ]
    : [];

const CHECKS: readonly Check[] = [
  contactedLeads,
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
