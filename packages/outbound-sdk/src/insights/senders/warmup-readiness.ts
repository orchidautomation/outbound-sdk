// warmup_readiness: which senders are not ready to send.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { SenderHealth } from "../../internal/entities-account.ts";
import type { Sender } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import { percent, rate, spoken } from "../stats.ts";
import { failingDns, readHealth, readSenders, warmupSpam } from "./read.ts";

const input = z.object({
  check_health: z
    .boolean()
    .default(false)
    .describe(
      "Also check each mailbox's DNS records and warmup spam. Costs 1 more request per mailbox."
    ),
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("The most senders to check"),
  max_spam_rate: z
    .number()
    .min(0)
    .max(1)
    .default(0.1)
    .describe(
      "With check_health, a mailbox whose warmup emails land in spam more often than this share is not ready"
    ),
  min_score: z
    .number()
    .min(0)
    .max(100)
    .default(90)
    .describe("The warmup score a mailbox needs to be ready"),
});

export const READINESS_REASONS = [
  "not_active",
  "warmup_off",
  "score_low",
  "score_unknown",
  "no_daily_limit",
  "dns_failing",
  "warmup_spam_high",
] as const;

export type ReadinessReason = (typeof READINESS_REASONS)[number];

export interface UnreadySender {
  readonly sender: string;
  readonly kind: "linkedin" | "mailbox";
  readonly address: string | null;
  readonly name: string | null;
  readonly status: string;
  /** `null` when the vendor does not say. */
  readonly warmupEnabled: boolean | null;
  readonly score: number | null;
  readonly dailyLimit: number | null;
  readonly reasons: readonly ReadinessReason[];
  /** Each reason in plain words, with the number behind it. */
  readonly findings: readonly string[];
}

export type ReadinessCounts = Readonly<Record<ReadinessReason, number>>;

export interface WarmupReadiness {
  /** Senders that are not ready, the one with the most reasons first. */
  readonly notReady: readonly UnreadySender[];
  readonly byReason: ReadinessCounts;
  readonly ready: number;
  readonly total: number;
  /** LinkedIn seats among the senders. They are judged on status only. */
  readonly linkedinSeats: number;
  /** `true` when DNS records and warmup spam were checked too. */
  readonly healthChecked: boolean;
}

interface Bars {
  readonly minScore: number;
  readonly maxSpamRate: number;
}

type Reason = readonly [ReadinessReason, string];

const healthReasons = (health: SenderHealth, bars: Bars): Reason[] => {
  const failing = failingDns(health);
  const spam = warmupSpam(health);
  const spamRate = spam === null ? null : rate(spam.spam, spam.sent);

  return [
    ...(failing.length > 0
      ? [
          [
            "dns_failing",
            `${failing.join(", ").toUpperCase()} failing`,
          ] as const,
        ]
      : []),
    ...(spam !== null && spamRate !== null && spamRate > bars.maxSpamRate
      ? [
          [
            "warmup_spam_high",
            `${spam.spam} of ${spam.sent} warmup emails landed in spam (${percent(spamRate)}, over ${percent(bars.maxSpamRate)})`,
          ] as const,
        ]
      : []),
  ];
};

const mailboxReasons = (
  sender: Sender,
  score: number | null,
  bars: Bars
): Reason[] => [
  ...(sender.warmup?.enabled === false
    ? [["warmup_off", "Warmup is off"] as const]
    : []),
  ...(score !== null && score < bars.minScore
    ? [
        [
          "score_low",
          `Warmup score ${spoken(score)} is under ${spoken(bars.minScore)}`,
        ] as const,
      ]
    : []),
  ...(score === null
    ? [["score_unknown", "The vendor reports no warmup score"] as const]
    : []),
  ...(sender.dailyLimit === null
    ? [["no_daily_limit", "No daily limit is set or reported"] as const]
    : []),
];

const judge = (
  sender: Sender,
  health: SenderHealth | null,
  bars: Bars
): UnreadySender => {
  const score = sender.warmup?.score ?? health?.warmup?.score ?? null;

  const reasons: Reason[] = [
    ...(sender.status === "active"
      ? []
      : [["not_active", `Status is ${sender.status}`] as const]),
    ...(sender.kind === "mailbox" ? mailboxReasons(sender, score, bars) : []),
    ...(health === null ? [] : healthReasons(health, bars)),
  ];

  return {
    address: sender.address,
    dailyLimit: sender.dailyLimit,
    findings: reasons.map(([, finding]) => finding),
    kind: sender.kind,
    name: sender.name,
    reasons: reasons.map(([reason]) => reason),
    score,
    sender: sender.ref,
    status: sender.status,
    warmupEnabled: sender.warmup?.enabled ?? null,
  };
};

const countReasons = (judged: readonly UnreadySender[]): ReadinessCounts => {
  const count = (reason: ReadinessReason): number =>
    judged.filter((sender) => sender.reasons.includes(reason)).length;

  return {
    dns_failing: count("dns_failing"),
    no_daily_limit: count("no_daily_limit"),
    not_active: count("not_active"),
    score_low: count("score_low"),
    score_unknown: count("score_unknown"),
    warmup_off: count("warmup_off"),
    warmup_spam_high: count("warmup_spam_high"),
  };
};

export const warmupReadiness = defineInsight({
  description:
    "Which senders are not ready to send, each with its reasons: warmup off, warmup score under the bar or not reported, status not active, no daily limit and, with check_health, failing DNS records or too many warmup emails in spam. Returns counts by reason and how many are ready. A LinkedIn seat is judged on its status only. Use it before attaching mailboxes to a campaign or raising their limits. Costs one listing of senders, plus 1 request per mailbox with check_health. A null score means the vendor does not report one, which counts as not ready, not as 0.",
  inputSchema: input,
  key: "warmupReadiness",
  name: "warmup_readiness",
  needs: ["senders.list"],
  next: "Use domain_health for the domains of the mailboxes that are not ready, or sender_capacity to see what the ready ones can send.",
  run: async (context, options) => {
    const { outbound } = context;

    const bars: Bars = {
      maxSpamRate: options.max_spam_rate,
      minScore: options.min_score,
    };

    const { items: senders } = await readSenders(context, options.max_senders);

    const healthChecked =
      options.check_health && outbound.capabilities["senders.health"];

    if (options.check_health && !healthChecked) {
      context.note(
        "DNS records and warmup spam were not checked: the adapter cannot read a sender's health."
      );
    }

    // Left off by default to save a request per mailbox; the note says so.
    if (
      !options.check_health &&
      outbound.capabilities["senders.health"] &&
      senders.some((sender) => sender.kind === "mailbox")
    ) {
      context.note(
        "DNS records and warmup spam were not checked, so a ready mailbox is ready on warmup alone. Pass check_health: true to check them, at 1 more request per mailbox."
      );
    }

    const each = await mapConcurrent(senders, async (sender) => {
      if (!healthChecked || sender.kind !== "mailbox") {
        return [judge(sender, null, bars)];
      }

      // A mailbox the vendor no longer finds is left out, with a note.
      const health = await readHealth(context, sender);

      return health === null ? [] : [judge(sender, health, bars)];
    });

    const judged: UnreadySender[] = each.flat();

    const notReady = judged
      .filter((sender) => sender.reasons.length > 0)
      .toSorted((left, right) => right.reasons.length - left.reasons.length);

    const answer: WarmupReadiness = {
      byReason: countReasons(notReady),
      healthChecked,
      linkedinSeats: senders.filter((sender) => sender.kind === "linkedin")
        .length,
      notReady,
      ready: judged.length - notReady.length,
      total: judged.length,
    };

    return answer;
  },
});
