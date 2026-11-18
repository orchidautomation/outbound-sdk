// The cards of sender_health and deliverability_check: which senders need
// attention, which were checked, and what a failing sender breaks.

import { field, isJsonObject } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { CardContent, Stat } from "./content.ts";
import {
  bool,
  child,
  DASH,
  int,
  noun,
  num,
  pct,
  plural,
  rows,
  show,
  str,
  strings,
  yesNo,
} from "./format.ts";
import { verdict } from "./parts.ts";

type CardBuilder = (data: Json) => CardContent;

const RIGHT = "right";
const LEFT = "left";

const warmup = (sender: JsonObject): string => {
  const score = num(sender, "warmupScore");

  if (score !== null) {
    return int(score);
  }

  const enabled = bool(sender, "warmupEnabled");

  if (enabled === null) {
    return DASH;
  }

  return enabled ? "On" : "Off";
};

/** Each campaign's name by ref, from the answer's top-level `campaigns`. */
const campaignNames = (data: Json): ReadonlyMap<string, string> =>
  new Map(
    rows(data, "campaigns").map((campaign) => [
      show(campaign, "campaign"),
      show(campaign, "campaignName"),
    ])
  );

/** What a failing sender breaks, in one line. Empty when no impact was read. */
const impactLine = (
  sender: JsonObject,
  names: ReadonlyMap<string, string>
): string => {
  if (!isJsonObject(field(sender, "impact"))) {
    return "";
  }

  const impact = child(sender, "impact");

  const campaigns = strings(impact, "activeCampaigns");
  const count = num(impact, "activeCampaignCount");
  const sent = num(child(impact, "recentSends"), "sent");
  const last = str(impact, "lastSentOn");

  const parts = [
    count === null
      ? "active campaigns unknown"
      : `${plural(count, "active campaign")}${campaigns.length === 0 ? "" : ` (${campaigns.map((ref) => names.get(ref) ?? ref).join(", ")})`}`,
    sent === null ? "recent sends unknown" : `${int(sent)} sent in 14 days`,
    ...(last === null ? [] : [`last sent ${last}`]),
  ];

  return `: ${parts.join(", ")}`;
};

/** Who the sender is, in words: its address, else its name. */
const who = (sender: JsonObject): string =>
  str(sender, "address") ?? str(sender, "name") ?? "A LinkedIn seat";

const failingBullets = (
  senders: readonly JsonObject[],
  names: ReadonlyMap<string, string>
): string[] =>
  senders.flatMap((sender) =>
    isJsonObject(field(sender, "impact"))
      ? [
          `🔴 **${who(sender)}** (${show(sender, "status")})${impactLine(sender, names)}`,
        ]
      : []
  );

export const senderHealth: CardBuilder = (data) => {
  const senders = rows(data, "senders");
  const unhealthy = num(data, "unhealthy") ?? 0;
  // A result from before `checked` counted only the senders it listed.
  const checked = num(data, "checked") ?? senders.length;
  const failing = num(data, "failing");

  const stats: Stat[] = [
    ["Senders checked", int(checked)],
    ["Not active", int(unhealthy)],
    ...(failing === null ? [] : [["Failing", int(failing)] as const]),
  ];

  return {
    bullets: failingBullets(senders, campaignNames(data)),
    finding: verdict(
      checked,
      unhealthy === 0
        ? null
        : `🔴 ${int(unhealthy)} of ${plural(checked, "sender")} ${unhealthy === 1 ? "needs" : "need"} attention.`,
      `No sender needs attention (${int(checked)} checked).`
    ),
    stats,
    table: {
      align: [LEFT, LEFT, LEFT, RIGHT, RIGHT],
      headers: ["Sender", "Kind", "Status", "Daily limit", "Warmup"],
      rows: senders.map((sender) => [
        str(sender, "address") ?? show(sender, "sender"),
        show(sender, "kind"),
        show(sender, "status"),
        int(num(sender, "dailyLimit")),
        warmup(sender),
      ]),
      // The more count covers every sender checked, not only those in the answer.
      total: checked,
    },
    title: "Sender health",
  };
};

const dns = (sender: JsonObject, record: string): string => {
  const passes = bool(child(sender, "dns"), record);

  if (passes === null) {
    return DASH;
  }

  return passes ? "✓" : "✗";
};

const coverageStats = (data: Json): Stat[] => {
  if (!isJsonObject(field(data, "coverage"))) {
    return [];
  }

  const coverage = child(data, "coverage");

  const byReason = child(coverage, "notCheckedByReason");

  return [
    ["Checked in full", int(num(coverage, "checked"))],
    ["Not checked", int(num(coverage, "notChecked"))],
    ...["cap", "unsupported", "error"].flatMap((reason): Stat[] => {
      const amount = num(byReason, reason) ?? 0;

      return amount === 0 ? [] : [[`Not checked: ${reason}`, int(amount)]];
    }),
  ];
};

export const deliverabilityCheck: CardBuilder = (data) => {
  const senders = rows(data, "senders");
  const broken = num(data, "withProblems") ?? 0;
  const screened = num(data, "screened") ?? senders.length;
  const names = campaignNames(data);

  return {
    bullets: senders.flatMap((sender) => {
      const problems = strings(sender, "problems");

      return problems.length === 0
        ? []
        : [
            `🔴 **${show(sender, "address")}**: ${problems.join("; ")}${impactLine(sender, names)}`,
          ];
    }),
    finding: verdict(
      screened,
      broken === 0
        ? null
        : `🔴 ${int(broken)} of ${plural(screened, "sender")} ${noun(broken, "has", "have")} a problem.`,
      `No problem found on ${plural(screened, "sender")}.`
    ),
    stats: coverageStats(data),
    table: {
      align: [LEFT, "center", "center", "center", "center", LEFT, RIGHT],
      headers: [
        "Sender",
        "SPF",
        "DKIM",
        "DMARC",
        "MX",
        "Signed in",
        "Spam rate",
      ],
      rows: senders.map((sender) =>
        bool(sender, "checked") === false
          ? [
              show(sender, "address"),
              DASH,
              DASH,
              DASH,
              DASH,
              `not checked (${show(child(sender, "notChecked"), "reason")})`,
              DASH,
            ]
          : [
              show(sender, "address"),
              dns(sender, "spf"),
              dns(sender, "dkim"),
              dns(sender, "dmarc"),
              dns(sender, "mx"),
              yesNo(bool(sender, "connected")),
              pct(num(sender, "warmupSpamRate")),
            ]
      ),
    },
    title: "Deliverability check",
  };
};
