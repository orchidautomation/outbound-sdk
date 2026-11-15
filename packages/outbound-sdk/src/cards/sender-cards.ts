// Cards for the sender and deliverability insights.

import type { JsonObject } from "../internal/json.ts";
import {
  bool,
  child,
  DASH,
  int,
  mark,
  num,
  pct,
  noun,
  plural,
  rows,
  show,
  str,
  strings,
  words,
} from "./format.ts";
import {
  countStats,
  flagged,
  LEFT,
  RIGHT,
  verdict,
  withInterval,
} from "./parts.ts";
import type { CardBuilder } from "./tool-cards.ts";

const senderName = (sender: JsonObject): string =>
  str(sender, "address") ?? str(sender, "name") ?? show(sender, "sender");

const bounceWatch: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const over = rows(data, "over");
  const threshold = pct(num(data, "threshold"));

  return {
    finding: verdict(
      (num(totals, "over") ?? 0) + (num(totals, "clean") ?? 0),
      over.length === 0
        ? null
        : `🔴 Above the ${threshold} bounce limit: ${plural(over.length, "campaign")}.`,
      `No campaign is above the ${threshold} bounce limit.`
    ),
    stats: [
      ["Over the limit", int(num(totals, "over"))],
      ["Clean", int(num(totals, "clean"))],
      ["Too few sends to judge", int(num(totals, "tooFewSends"))],
      ["Not reported", int(num(totals, "unknown"))],
      ["Overall bounce rate", pct(num(totals, "rate"))],
    ],
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT],
      headers: ["Campaign", "Sent", "Bounced", "Bounce rate"],
      rows: over.map((campaign) => [
        show(campaign, "name"),
        int(num(campaign, "sent")),
        int(num(campaign, "bounced")),
        withInterval(campaign, "rate", "interval"),
      ]),
    },
    title: "Bounce watch",
  };
};

const RISK_ORDER = ["high", "medium", "unknown", "low"];

// A low risk is good news, unlike a low severity, so it is green.
const riskMark = (risk: string | null): string =>
  risk === "low" ? mark("ok") : mark(risk);

// Silence about DNS is not good news, so it is not told as "no high risk".
const unknownRisk = (unknown: number): string | null =>
  unknown === 0
    ? null
    : `⚪ ${plural(unknown, "sending domain")} of unknown risk: the vendor reports none of SPF, DKIM, DMARC and MX for ${unknown === 1 ? "it" : "them"}. No domain is at high risk on what it reports.`;

const domainHealth: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const high = num(totals, "high") ?? 0;
  const unknown = num(totals, "unknown") ?? 0;

  const domains = rows(data, "domains").toSorted(
    (left, right) =>
      RISK_ORDER.indexOf(show(left, "risk")) -
      RISK_ORDER.indexOf(show(right, "risk"))
  );

  return {
    bullets: domains.flatMap((domain) => {
      const reasons = strings(domain, "reasons");

      return reasons.length === 0 || str(domain, "risk") === "low"
        ? []
        : [
            `${riskMark(str(domain, "risk"))} **${show(domain, "domain")}**: ${reasons.join("; ")}`,
          ];
    }),
    finding: verdict(
      num(totals, "domains"),
      high > 0
        ? `🔴 ${plural(high, "sending domain")} at high risk.`
        : unknownRisk(unknown),
      "No sending domain is at high risk."
    ),
    stats: [
      ["Domains", int(num(totals, "domains"))],
      ["High risk", int(high)],
      ["Medium risk", int(num(totals, "medium"))],
      ["Low risk", int(num(totals, "low"))],
      ["Unknown risk", int(unknown)],
      ["LinkedIn seats", int(num(totals, "linkedinSeats"))],
    ],
    table: {
      align: [LEFT, LEFT, RIGHT, LEFT, RIGHT, LEFT],
      headers: [
        "Domain",
        "Risk",
        "Mailboxes",
        "Failing DNS",
        "Warmup spam",
        "Not reported",
      ],
      rows: domains.map((domain) => [
        show(domain, "domain"),
        `${riskMark(str(domain, "risk"))} ${show(domain, "risk")}`,
        int(rows(domain, "mailboxes").length),
        strings(domain, "failingDns").join(" ").toUpperCase() || DASH,
        pct(num(child(domain, "warmup"), "spamRate")),
        strings(domain, "notReported").join(", ") || DASH,
      ]),
    },
    title: "Domain health",
  };
};

const senderCapacity: CardBuilder = (data) => {
  const capacity = child(data, "capacity");
  const sends = child(data, "sends");

  return {
    bullets: rows(data, "shortCampaigns").map(
      (campaign) => `🟡 ${show(campaign, "finding")}`
    ),
    finding: str(data, "finding"),
    stats: [
      ["Daily capacity", int(num(capacity, "daily"))],
      ["Campaigns ask for", int(num(child(data, "ask"), "daily"))],
      ["Average sent per day", int(num(sends, "averageDaily"))],
      ["Sent by senders not counted", int(num(sends, "fromUncounted"))],
      ["Capacity in use", pct(num(data, "utilization"))],
      ["Active senders", int(num(capacity, "activeSenders"))],
      ["Inactive senders", int(num(capacity, "inactiveSenders"))],
    ],
    title: "Sender capacity",
  };
};

const senderLoad: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const overused = rows(data, "overused");
  const risky = rows(data, "campaigns");
  const unused = rows(data, "unused");

  return {
    bullets: [
      ...overused.map((sender) => `🔴 ${show(sender, "finding")}`),
      ...risky.map((campaign) => `🟡 ${show(campaign, "finding")}`),
      ...(unused.length > 0
        ? [
            `⚪ Not used by any campaign: ${unused
              .slice(0, 5)
              .map((sender) => senderName(sender))
              .join(", ")}`,
          ]
        : []),
    ],
    finding: verdict(
      num(totals, "senders"),
      overused.length + risky.length === 0
        ? null
        : `${plural(overused.length, "sender")} overused, ${plural(
            risky.length,
            "campaign"
          )} at risk.`,
      "No sender is overused and no campaign is short of senders."
    ),
    stats: [
      ["Senders", int(num(totals, "senders"))],
      ["Active", int(num(totals, "activeSenders"))],
      ["Overused", int(num(totals, "overused"))],
      ["Unused", int(num(totals, "unused"))],
      ["Campaigns at risk", int(num(totals, "campaignsAtRisk"))],
    ],
    title: "Sender load",
  };
};

const settingsAudit: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const flaggedCampaigns = num(totals, "withFindings") ?? 0;

  return {
    bullets: rows(data, "campaigns").flatMap((campaign) =>
      rows(campaign, "findings").map((finding) =>
        flagged(finding, `**${show(campaign, "name")}**: `)
      )
    ),
    finding: verdict(
      num(totals, "campaigns"),
      flaggedCampaigns === 0
        ? null
        : `${plural(flaggedCampaigns, "campaign")} with a setting to look at.`,
      "No campaign setting looks wrong."
    ),
    stats: [
      ["Campaigns", int(num(totals, "campaigns"))],
      ["High", int(num(totals, "high"))],
      ["Medium", int(num(totals, "medium"))],
      ["Low", int(num(totals, "low"))],
    ],
    title: "Settings audit",
  };
};

const warmupReadiness: CardBuilder = (data) => {
  const notReady = rows(data, "notReady");
  // Without sender health, "ready" rests on warmup and status alone.
  const checked = bool(data, "healthChecked") !== false;
  const ready = checked ? "ready to send" : "ready on warmup alone";

  const unchecked = checked ? "" : "; DNS and warmup spam were not checked";

  return {
    finding: verdict(
      num(data, "total"),
      notReady.length === 0
        ? null
        : `🟡 ${int(num(data, "ready"))} of ${plural(num(data, "total") ?? 0, "sender")} ${noun(num(data, "ready") ?? 0, "is", "are")} ${ready}${unchecked}.`,
      `Every sender is ${ready} (${int(num(data, "total"))} checked)${unchecked}.`
    ),
    stats: [
      ["Ready", int(num(data, "ready"))],
      ["Not ready", int(notReady.length)],
      ...countStats(child(data, "byReason")),
    ],
    table: {
      align: [LEFT, LEFT, RIGHT, LEFT],
      headers: ["Sender", "Status", "Warmup score", "Why not"],
      rows: notReady.map((sender) => [
        senderName(sender),
        show(sender, "status"),
        int(num(sender, "score")),
        strings(sender, "reasons")
          .map((reason) => words(reason).toLowerCase())
          .join(", "),
      ]),
    },
    title: "Warmup readiness",
  };
};

export const SENDER_CARDS: ReadonlyMap<string, CardBuilder> = new Map([
  ["bounce_watch", bounceWatch],
  ["domain_health", domainHealth],
  ["sender_capacity", senderCapacity],
  ["sender_load", senderLoad],
  ["settings_audit", settingsAudit],
  ["warmup_readiness", warmupReadiness],
]);
