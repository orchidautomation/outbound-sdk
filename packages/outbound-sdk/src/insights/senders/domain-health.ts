// domain_health: deliverability per sending domain.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { SenderHealth } from "../../internal/entities-account.ts";
import type { Sender } from "../../internal/entities.ts";
import { noun, plural } from "../../internal/plural.ts";
import { renamed } from "../../internal/renamed.ts";
import { defineInsight } from "../define.ts";
import { measure } from "../ops/shared.ts";
import type { Measured } from "../ops/shared.ts";
import { percent, wilson } from "../stats.ts";
import type { Interval } from "../stats.ts";
import {
  DNS_RECORDS,
  domainOf,
  failingDns,
  readHealth,
  readSenders,
  unknownDns,
  warmupSpam,
} from "./read.ts";
import type { DnsRecord } from "./read.ts";

const maxSpamRate = z.number().min(0).max(1);

const input = z.object({
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("The most senders to check. Each costs 1 request."),
  max_spam_rate: maxSpamRate
    .default(0.1)
    .describe(
      "A domain whose warmup emails land in spam more often than this share is high risk"
    ),
  spam_rate_threshold: renamed("max_spam_rate", maxSpamRate),
});

export type DomainRisk = "high" | "low" | "medium" | "unknown";

export interface DomainMailbox {
  readonly sender: string;
  readonly address: string | null;
  readonly status: string;
  /** `null` when the vendor does not say. */
  readonly connected: boolean | null;
  readonly blacklisted: boolean | null;
  readonly failingDns: readonly DnsRecord[];
  /** Problems in the vendor's own words. */
  readonly issues: readonly string[];
}

export interface DomainWarmup extends Measured {
  /** Mailboxes that report warmup spam. The pooled numbers cover only these. */
  readonly mailboxes: number;
  readonly sent: number | null;
  readonly spam: number | null;
  /** @deprecated Use `rate`: warmup emails in spam (`count`) over those sent (`of`). Removed in 0.5.0. */
  readonly spamRate: number | null;
  /** @deprecated Use `low` and `high`. Removed in 0.5.0. */
  readonly interval: Interval | null;
}

export interface DomainReport {
  readonly domain: string;
  readonly risk: DomainRisk;
  /** Why the domain has its risk level, most serious first. */
  readonly reasons: readonly string[];
  readonly mailboxes: readonly DomainMailbox[];
  /** DNS records that fail on at least one mailbox. */
  readonly failingDns: readonly DnsRecord[];
  readonly disconnected: number;
  /** Mailboxes on a block list. `null` when no mailbox of the domain reports its block list status. */
  readonly blacklisted: number | null;
  readonly warmup: DomainWarmup;
  /** Checks the vendor reported for no mailbox of the domain. */
  readonly notReported: readonly string[];
}

export interface LinkedinSeat {
  readonly sender: string;
  readonly name: string | null;
  readonly linkedinUrl: string | null;
  readonly status: string;
  readonly connected: boolean | null;
  readonly issues: readonly string[];
}

export interface DomainHealth {
  /** Worst domain first. */
  readonly domains: readonly DomainReport[];
  /** LinkedIn seats have no domain; disconnected seats first. */
  readonly linkedinSeats: readonly LinkedinSeat[];
  /** Mailboxes whose domain is not known, by sender ref. */
  readonly mailboxesWithoutDomain: readonly string[];
  readonly totals: {
    /** Senders checked. One the vendor no longer finds is left out, with a note. */
    readonly senders: number;
    readonly domains: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly unknown: number;
    readonly linkedinSeats: number;
  };
}

interface Checked {
  readonly sender: Sender;
  readonly health: SenderHealth;
}

const RISK_ORDER: readonly DomainRisk[] = ["high", "medium", "low", "unknown"];

const pooledWarmup = (checked: readonly Checked[]): DomainWarmup => {
  const reported = checked.flatMap(({ health }) => {
    const spam = warmupSpam(health);

    return spam === null ? [] : [spam];
  });

  if (reported.length === 0) {
    return {
      ...measure(null, null),
      interval: null,
      mailboxes: 0,
      sent: null,
      spam: null,
      spamRate: null,
    };
  }

  const sent = reported.reduce((sum, each) => sum + each.sent, 0);
  const spam = reported.reduce((sum, each) => sum + each.spam, 0);
  const measured = measure(spam, sent);

  return {
    ...measured,
    interval: wilson(spam, sent),
    mailboxes: reported.length,
    sent,
    spam,
    spamRate: measured.rate,
  };
};

const missingChecks = (
  checked: readonly Checked[],
  warmup: DomainWarmup
): string[] => [
  ...DNS_RECORDS.filter((record) =>
    checked.every(({ health }) => unknownDns(health).includes(record))
  ),
  ...(checked.every(({ health }) => health.connected === null)
    ? ["connection"]
    : []),
  ...(checked.every(({ health }) => health.blacklisted === null)
    ? ["blocklist"]
    : []),
  ...(warmup.mailboxes === 0 ? ["warmup"] : []),
];

const reportFor = (
  domain: string,
  checked: readonly Checked[],
  threshold: number
): DomainReport => {
  const failing = DNS_RECORDS.filter((record) =>
    checked.some(({ health }) => health.dns[record] === false)
  );

  const warmup = pooledWarmup(checked);
  const notReported = missingChecks(checked, warmup);

  const blacklisted = notReported.includes("blocklist")
    ? null
    : checked.filter(({ health }) => health.blacklisted === true).length;

  const disconnected = checked.filter(
    ({ health }) => health.connected === false
  ).length;

  const authFailing = failing.filter((record) => record !== "dmarc");
  const spamHigh = warmup.rate !== null && warmup.rate > threshold;

  const high = [
    ...((blacklisted ?? 0) > 0
      ? [
          `${blacklisted} of ${plural(checked.length, "mailbox", "mailboxes")} ${noun(blacklisted ?? 0, "is", "are")} on a block list`,
        ]
      : []),
    ...(authFailing.length > 0
      ? [`${authFailing.join(", ").toUpperCase()} failing`]
      : []),
    ...(spamHigh
      ? [
          `${warmup.spam} of ${warmup.sent} warmup emails landed in spam (${percent(warmup.rate)}, over ${percent(threshold)})`,
        ]
      : []),
  ];

  const medium = [
    ...(failing.includes("dmarc") ? ["DMARC failing"] : []),
    ...(disconnected > 0
      ? [
          `${disconnected} of ${plural(checked.length, "mailbox", "mailboxes")} ${noun(disconnected, "is", "are")} disconnected`,
        ]
      : []),
  ];

  // With no DNS record reported, nothing says the domain is sound.
  const calm: DomainRisk = DNS_RECORDS.every((record) =>
    notReported.includes(record)
  )
    ? "unknown"
    : "low";

  const lesser: DomainRisk = medium.length > 0 ? "medium" : calm;

  return {
    blacklisted,
    disconnected,
    domain,
    failingDns: failing,
    mailboxes: checked.map(({ health, sender }) => ({
      address: sender.address,
      blacklisted: health.blacklisted,
      connected: health.connected,
      failingDns: failingDns(health),
      issues: health.issues,
      sender: sender.ref,
      status: sender.status,
    })),
    notReported,
    reasons: [...high, ...medium],
    risk: high.length > 0 ? "high" : lesser,
    warmup,
  };
};

const worstFirst = (left: DomainReport, right: DomainReport): number =>
  RISK_ORDER.indexOf(left.risk) - RISK_ORDER.indexOf(right.risk) ||
  right.reasons.length - left.reasons.length ||
  (right.warmup.rate ?? -1) - (left.warmup.rate ?? -1) ||
  left.domain.localeCompare(right.domain);

// A seat the vendor cannot sign in to comes first, then one it says nothing about.
const seatRank = (seat: LinkedinSeat): number => {
  if (seat.connected === false) {
    return 0;
  }

  return seat.connected === null ? 1 : 2;
};

export const domainHealth = defineInsight({
  description:
    "Deliverability per sending domain: for each domain its mailboxes, which DNS records (SPF, DKIM, DMARC, MX) fail, how many mailboxes are disconnected or on a block list, the share of warmup emails landing in spam pooled over its mailboxes, and a risk level with the reasons, worst domain first. LinkedIn seats are listed apart with their connection state. Use it before scaling volume or when replies drop. Costs one listing of senders plus 1 request per sender. A null count or rate means the vendor does not report it; a domain with no DNS record reported has the risk `unknown`, not `low`.",
  inputSchema: input,
  key: "domainHealth",
  name: "domain_health",
  needs: ["senders.list", "senders.health"],
  next: "Use warmup_readiness to see which mailboxes of a risky domain are not ready, or bounce_watch to see whether bounces already rose.",
  run: async (
    context,
    { max_senders: maxSenders, max_spam_rate: threshold }
  ) => {
    const { items: senders } = await readSenders(context, maxSenders);

    const byDomain = new Map<string, Checked[]>();
    const linkedinSeats: LinkedinSeat[] = [];
    const mailboxesWithoutDomain: string[] = [];

    const read = await mapConcurrent(senders, async (sender) => ({
      health: await readHealth(context, sender),
      sender,
    }));

    // A sender the vendor no longer finds is left out, with a note.
    const checks = read.flatMap(({ health, sender }) =>
      health === null ? [] : [{ health, sender }]
    );

    for (const { health, sender } of checks) {
      const domain = health.domain ?? domainOf(sender.address);

      if (sender.kind === "linkedin") {
        linkedinSeats.push({
          connected: health.connected,
          issues: health.issues,
          linkedinUrl: sender.linkedinUrl,
          name: sender.name,
          sender: sender.ref,
          status: sender.status,
        });
      } else if (domain === null) {
        mailboxesWithoutDomain.push(sender.ref);
      } else {
        byDomain.set(domain, [
          ...(byDomain.get(domain) ?? []),
          { health, sender },
        ]);
      }
    }

    const domains = [...byDomain]
      .map(([domain, checked]) => reportFor(domain, checked, threshold))
      .toSorted(worstFirst);

    const count = (risk: DomainRisk): number =>
      domains.filter((domain) => domain.risk === risk).length;

    const answer: DomainHealth = {
      domains,
      linkedinSeats: linkedinSeats.toSorted(
        (left, right) => seatRank(left) - seatRank(right)
      ),
      mailboxesWithoutDomain,
      totals: {
        domains: domains.length,
        high: count("high"),
        linkedinSeats: linkedinSeats.length,
        low: count("low"),
        medium: count("medium"),
        senders: checks.length,
        unknown: count("unknown"),
      },
    };

    return answer;
  },
});
