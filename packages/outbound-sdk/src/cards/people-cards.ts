// Cards for the people and account insights.

import type { Json, JsonObject } from "../internal/json.ts";
import type { Stat } from "./content.ts";
import {
  bool,
  child,
  DASH,
  day,
  int,
  num,
  pct,
  people,
  plural,
  rows,
  show,
  stepsOf,
  str,
  strings,
  waiting,
  words,
} from "./format.ts";
import { LEFT, RIGHT, verdict } from "./parts.ts";
import type { CardBuilder } from "./tool-cards.ts";

const personSummary: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const channels = child(totals, "byChannel");

  return {
    finding:
      bool(data, "found") === false
        ? "No record carries this identifier."
        : `Replied in ${int(num(totals, "campaignsReplied"))} of ${plural(
            num(totals, "campaigns") ?? 0,
            "campaign"
          )}.`,
    stats: [
      ["Messages sent", int(num(totals, "messagesSent"))],
      ["Replies", int(num(totals, "replies"))],
      ...Object.keys(channels).map((channel): Stat => [
        words(channel),
        `${int(num(child(channels, channel), "messagesSent"))} sent · ${plural(
          num(child(channels, channel), "replies"),
          "reply",
          "replies"
        )}`,
      ]),
    ],
    subtitle: people(data, "identifiers"),
    table: {
      align: [LEFT, LEFT, RIGHT, RIGHT, LEFT, LEFT],
      headers: [
        "Campaign",
        "Channel",
        "Sent",
        "Replies",
        "Interest",
        "Last contact",
      ],
      rows: rows(data, "campaigns").map((campaign) => [
        str(campaign, "campaignName") ?? show(campaign, "campaign"),
        show(campaign, "channel"),
        int(num(campaign, "messagesSent")),
        int(num(campaign, "replies")),
        show(campaign, "interest"),
        day(str(campaign, "lastContactedAt")),
      ]),
    },
    title: "Person summary",
  };
};

/**
 * With nobody found, the answer's own sentence says whether that means nobody
 * is there or only that the leads read held nobody.
 */
const accountFinding = (data: Json): string => {
  const last = child(data, "lastReply");

  if (num(child(data, "totals"), "people") === 0) {
    return str(data, "finding") ?? "Nobody at this company was found.";
  }

  return str(last, "at") === null
    ? "Nobody at this company has replied."
    : `Last reply: ${str(last, "name") ?? show(last, "email")} on ${day(
        str(last, "at")
      )}.`;
};

const accountSummary: CardBuilder = (data) => {
  const totals = child(data, "totals");

  return {
    bullets:
      bool(totals, "moreLeadsExist") === true
        ? [
            `🟡 Stopped at ${plural(num(totals, "leadsRead") ?? 0, "lead")} read; more exist, so people at this company may be missing.`,
          ]
        : [],
    finding: accountFinding(data),
    stats: [
      ["People", int(num(totals, "people"))],
      ["Replied", int(num(totals, "replied"))],
      ["Interested", int(num(totals, "interested"))],
      ["Campaigns", int(num(totals, "campaigns"))],
    ],
    subtitle: show(data, "domain"),
    table: {
      align: [LEFT, LEFT, RIGHT, RIGHT, LEFT],
      headers: ["Person", "Title", "Campaigns", "Replies", "Last reply"],
      rows: rows(data, "people").map((person) => [
        str(person, "name") ?? show(person, "email"),
        show(person, "title"),
        int(strings(person, "campaigns").length),
        int(num(person, "replies")),
        day(str(person, "lastRepliedAt")),
      ]),
    },
    title: "Account summary",
  };
};

const findings = (items: readonly JsonObject[], dot: string): string[] =>
  items.map((item) => `${dot} ${show(item, "finding")}`);

const leadCollisions: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const found = num(totals, "collisions") ?? 0;
  // Older answers have no `concurrent`: every collision was then reported as concurrent.
  const concurrent = num(totals, "concurrent") ?? found;

  const problem =
    concurrent > 0
      ? `🟡 ${plural(concurrent, "person", "people")} in two or more campaigns at once.`
      : `🟡 ${plural(found, "person", "people")} in two or more campaigns, none active in two now.`;

  return {
    bullets: findings(rows(data, "collisions"), "🟡"),
    finding: verdict(
      num(totals, "leadsRead"),
      found === 0 ? null : problem,
      "Nobody is in two campaigns at once."
    ),
    stats: [
      ["Collisions", int(found)],
      ["Across tools", int(num(totals, "acrossTools"))],
      ["Within one tool", int(num(totals, "withinTool"))],
      ["Leads read", int(num(totals, "leadsRead"))],
    ],
    title: "Lead collisions",
  };
};

const suppressionCheck: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const found = num(totals, "violations") ?? 0;
  const byMatch = child(totals, "byMatch");
  const moreEntries = bool(totals, "moreBlockEntriesExist") === true;

  const capped = [
    ...(moreEntries
      ? [
          `🟡 Stopped at ${plural(num(totals, "blockEntriesRead") ?? 0, "block list entry", "block list entries")}; more exist and were not checked.`,
        ]
      : []),
    ...(bool(totals, "moreLeadsExist") === true
      ? ["🟡 A campaign had more leads than were read; those were not checked."]
      : []),
  ];

  const problem =
    found === 0
      ? null
      : `🔴 ${plural(found, "blocked lead")} still in a campaign.`;

  return {
    bullets: [...capped, ...findings(rows(data, "violations"), "🔴")],
    finding: verdict(
      num(totals, "leadsRead"),
      problem ??
        (moreEntries
          ? "🟡 No blocked lead found in the entries read, but more entries exist."
          : null),
      "No blocked lead is in a campaign."
    ),
    stats: [
      ["Violations", int(found)],
      ["Already stopped, not counted", int(num(totals, "alreadyStopped"))],
      ["By email", int(num(byMatch, "email"))],
      ["By domain", int(num(byMatch, "domain"))],
      ["By LinkedIn", int(num(byMatch, "linkedin"))],
      ["Leads read", int(num(totals, "leadsRead"))],
      ["Block entries read", int(num(totals, "blockEntriesRead"))],
    ],
    title: "Suppression check",
  };
};

const droppedReplies: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const dropped = rows(data, "dropped");
  const [longest] = dropped;

  return {
    bullets:
      bool(totals, "moreRepliesExist") === true
        ? [
            `🟡 Stopped at ${plural(num(totals, "repliesRead") ?? 0, "reply", "replies")} read; more exist and were not checked.`,
          ]
        : [],
    finding: verdict(
      num(totals, "repliesRead"),
      longest === undefined
        ? null
        : `🔴 ${plural(dropped.length, "reply", "replies")} waiting. The longest has waited ${waiting(num(longest, "hoursWaiting"))}.`,
      "Every reply read has an answer."
    ),
    stats: [
      ["Unanswered", int(num(totals, "dropped"))],
      ["Answered", int(num(totals, "answered"))],
      ["Conversations", int(num(totals, "conversations"))],
      ["Too recent to count", int(num(totals, "tooRecent"))],
    ],
    table: {
      align: [LEFT, LEFT, LEFT, RIGHT],
      cards: { subtitle: [1, 2, 3], title: 0 },
      headers: ["Lead", "Campaign", "Category", "Waiting"],
      rows: dropped.map((reply) => [
        str(reply, "name") ??
          str(reply, "email") ??
          str(reply, "linkedinUrl") ??
          show(reply, "lead"),
        str(reply, "campaignName") ?? show(reply, "campaign"),
        words(show(reply, "category")),
        waiting(num(reply, "hoursWaiting")),
      ]),
    },
    title: "Replies nobody answered",
  };
};

const hotLeads: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const leads = rows(data, "leads");
  const fromReplies = num(totals, "fromReplies") ?? 0;
  // Leads labelled negative score 0 and fill the room left, so they are not hot.
  const hot = num(totals, "hot") ?? leads.length;

  return {
    bullets:
      bool(totals, "moreLeadsExist") === true
        ? [
            `🟡 Stopped at ${plural(num(totals, "leadsRead") ?? 0, "lead")} read; more exist and were not scored${fromReplies > 0 ? `, except ${plural(fromReplies, "lead")} found through recent replies` : ""}.`,
          ]
        : [],
    finding:
      leads.length === 0 || hot === 0
        ? "No lead scores as hot yet."
        : `${plural(hot, "lead")} to call first.`,
    stats: [
      ["Hot", int(num(totals, "hot"))],
      ["Scored", int(num(totals, "scored"))],
      ["Leads read", int(num(totals, "leadsRead"))],
    ],
    table: {
      align: [LEFT, LEFT, RIGHT, LEFT],
      cards: { body: 3, subtitle: [1, 2], title: 0 },
      headers: ["Lead", "Company", "Score", "Why"],
      rows: leads.map((lead) => [
        str(lead, "name") ??
          str(lead, "email") ??
          str(lead, "linkedinUrl") ??
          show(lead, "lead"),
        show(lead, "company"),
        int(num(lead, "score")),
        show(lead, "reason"),
      ]),
    },
    title: "Hot leads",
  };
};

const personalizationGaps: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const affected = num(totals, "leadsAffected") ?? 0;
  const unknown = strings(data, "unknownVariables");

  return {
    bullets: unknown.map(
      (name) => `🟡 \`${name}\` is not a field any lead has.`
    ),
    finding: verdict(
      num(totals, "leadsRead"),
      affected === 0
        ? null
        : `🔴 ${plural(affected, "lead")} will get broken copy (${pct(
            num(totals, "affectedRate")
          )} of those read).`,
      "Every lead read has a value for every variable."
    ),
    stats: [
      ["Leads affected", int(affected)],
      ["Leads read", int(num(totals, "leadsRead"))],
      ["Variables", int(num(totals, "variables"))],
      ["Steps", int(num(totals, "steps"))],
    ],
    subtitle: show(data, "campaign"),
    table: {
      align: [LEFT, LEFT, LEFT, RIGHT],
      headers: ["Variable", "Source", "Steps", "Leads without it"],
      rows: rows(data, "variables")
        .filter((variable) => bool(variable, "gap") === true)
        .map((variable) => [
          show(variable, "name"),
          show(variable, "source"),
          stepsOf(variable, "steps") || DASH,
          int(num(variable, "leadsWithoutValue")),
        ]),
    },
    title: "Personalization gaps",
  };
};

export const PEOPLE_CARDS: ReadonlyMap<string, CardBuilder> = new Map([
  ["account_summary", accountSummary],
  ["dropped_replies", droppedReplies],
  ["hot_leads", hotLeads],
  ["lead_collisions", leadCollisions],
  ["person_summary", personSummary],
  ["personalization_gaps", personalizationGaps],
  ["suppression_check", suppressionCheck],
]);
