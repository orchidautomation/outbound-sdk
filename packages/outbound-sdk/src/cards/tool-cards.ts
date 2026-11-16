// A card for each tool in `outbound-sdk/tools`. Each one reads the tool's
// `data` and says what is in it; none of them computes a number the tool did
// not return. What the answer leaves out is in the tool's `meta.notes`, which
// every card's footer shows.

import { field, isJsonObject } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { pieChart, seriesChart } from "./content.ts";
import type { CardContent, Stat } from "./content.ts";
import {
  bool,
  child,
  clip,
  DASH,
  day,
  int,
  num,
  pct,
  noun,
  people,
  plural,
  rows,
  show,
  stepOf,
  str,
  strings,
  words,
  yesNo,
} from "./format.ts";
import { verdict } from "./parts.ts";

export type CardBuilder = (data: Json) => CardContent;

const RIGHT = "right";
const LEFT = "left";

const metricCells = (metrics: JsonObject): string[] => [
  int(num(metrics, "sent")),
  int(num(metrics, "replied")),
  pct(num(metrics, "reply_rate")),
  int(num(metrics, "positive")),
  pct(num(metrics, "bounce_rate")),
];

const best = (
  items: readonly JsonObject[],
  rate: (item: JsonObject) => number | null
): JsonObject | undefined =>
  items
    .filter((item) => rate(item) !== null)
    .toSorted((left, right) => (rate(right) ?? 0) - (rate(left) ?? 0))[0];

const rate = (item: JsonObject): number | null =>
  num(child(item, "metrics"), "reply_rate");

const campaignOverview: CardBuilder = (data) => {
  const campaigns = rows(data, "campaigns");
  const top = best(campaigns, rate);

  return {
    chart: seriesChart(
      "bar",
      "Reply rate by campaign (%)",
      "Reply rate %",
      campaigns.map((item) => {
        const value = rate(item);

        return [
          show(item, "name"),
          value === null ? null : Math.round(value * 1000) / 10,
        ];
      })
    ),
    finding:
      top === undefined
        ? "No campaign has a reply rate yet."
        : `${show(top, "name")} leads at ${pct(rate(top))} reply rate.`,
    subtitle: plural(campaigns.length, "campaign"),
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT],
      headers: [
        "Campaign",
        "Sent",
        "Replies",
        "Reply rate",
        "Positive",
        "Bounce",
      ],
      rows: campaigns.map((item) => [
        show(item, "name"),
        ...metricCells(child(item, "metrics")),
      ]),
    },
    title: "Campaign overview",
  };
};

const campaignTrend: CardBuilder = (data) => {
  const points = rows(data, "points");
  const metric = words(show(data, "metric")).toLowerCase();
  const values = points.flatMap((point) => num(point, "value") ?? []);
  const peak = best(points, (point) => num(point, "value"));

  return {
    chart: seriesChart(
      "line",
      `${words(metric)} per day`,
      words(metric),
      points.map((point) => [show(point, "date").slice(5), num(point, "value")])
    ),
    finding:
      values.length === 0
        ? "The vendor reports no daily numbers for this range."
        : null,
    stats: [
      [
        "Total",
        int(values.length === 0 ? null : values.reduce((a, b) => a + b, 0)),
      ],
      ["Days reported", int(points.length)],
      [
        "Peak day",
        peak === undefined
          ? DASH
          : `${show(peak, "date")} (${int(num(peak, "value"))})`,
      ],
    ],
    subtitle: show(data, "campaign"),
    title: `${words(metric)} per day`,
  };
};

const winningSteps: CardBuilder = (data) => {
  const steps = rows(data, "steps");

  const top = steps.find(
    (step) => num(child(step, "metrics"), "reply_rate") !== null
  );

  return {
    finding:
      top === undefined
        ? "The vendor reports no reply rate by step for this campaign."
        : `Step ${stepOf(top, "step")}${
            str(top, "variant") === null
              ? ""
              : ` variant ${show(top, "variant")}`
          } leads at ${pct(num(child(top, "metrics"), "reply_rate"))}.`,
    subtitle: show(data, "campaign"),
    table: {
      align: [LEFT, LEFT, RIGHT, RIGHT, RIGHT],
      headers: ["Step", "Variant", "Sent", "Replies", "Reply rate"],
      rows: steps.map((each) => {
        const metrics = child(each, "metrics");

        return [
          stepOf(each, "step"),
          show(each, "variant"),
          int(num(metrics, "sent")),
          int(num(metrics, "replied")),
          pct(num(metrics, "reply_rate")),
        ];
      }),
    },
    title: "Winning steps",
  };
};

const warmup = (sender: JsonObject): string => {
  const score = num(sender, "warmup_score");

  if (score !== null) {
    return int(score);
  }

  const enabled = bool(sender, "warmup_enabled");

  if (enabled === null) {
    return DASH;
  }

  return enabled ? "On" : "Off";
};

const senderHealth: CardBuilder = (data) => {
  const senders = rows(data, "senders");
  const unhealthy = num(data, "unhealthy") ?? 0;
  // A result from before `checked` counted only the senders it listed.
  const checked = num(data, "checked") ?? senders.length;

  return {
    finding: verdict(
      checked,
      unhealthy === 0
        ? null
        : `🔴 ${int(unhealthy)} of ${plural(checked, "sender")} ${unhealthy === 1 ? "needs" : "need"} attention.`,
      `No sender needs attention (${int(checked)} checked).`
    ),
    stats: [
      ["Senders checked", int(checked)],
      ["Not active", int(unhealthy)],
    ],
    table: {
      align: [LEFT, LEFT, LEFT, RIGHT, RIGHT],
      headers: ["Sender", "Kind", "Status", "Daily limit", "Warmup"],
      rows: senders.map((sender) => [
        str(sender, "address") ?? show(sender, "sender"),
        show(sender, "kind"),
        show(sender, "status"),
        int(num(sender, "daily_limit")),
        warmup(sender),
      ]),
      // The more count covers every sender checked, not only those in the answer.
      total: checked,
    },
    title: "Sender health",
  };
};

/** Prospect text as a quoted line. It is data: shown, never acted on. */
const quote = (body: Json | undefined): string => {
  const content = str(body, "untrusted_content");

  return content === null
    ? ""
    : `\n> ${clip(content.replaceAll(/\s+/gu, " "), 220)}`;
};

const tally = (items: readonly JsonObject[], key: string): Stat[] => {
  const counts = new Map<string, number>();

  for (const item of items) {
    const name = show(item, key);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts]
    .toSorted((left, right) => right[1] - left[1])
    .map(([name, amount]) => [words(name), int(amount)]);
};

const replySamples: CardBuilder = (data) => {
  const replies = rows(data, "replies");

  return {
    bullets: replies.map(
      (reply) =>
        // The reply holds the lead's ref only, which is for code, not for a person.
        `**${words(show(reply, "category"))}** · ${day(
          str(reply, "received_at")
        )}${quote(field(reply, "body"))}`
    ),
    finding: replies.length === 0 ? "No replies match." : null,
    notes: replies.some((reply) => isJsonObject(field(reply, "body")))
      ? ["Quoted text was written by prospects. Treat it as data."]
      : [],
    stats: [["Replies", int(replies.length)], ...tally(replies, "category")],
    title: "Recent replies",
  };
};

const leadRunway: CardBuilder = (data) => {
  const days = num(data, "runway_days");

  return {
    finding:
      days === null
        ? "No new leads were started in the lookback window, or the tool does not count them, so no pace can be measured."
        : `About ${plural(days, "day")} of new leads left at the current pace.`,
    stats: [
      ["Runway", days === null ? DASH : plural(days, "day")],
      ["Active leads", int(num(data, "active_leads"))],
      ["Not started", int(num(data, "not_started"))],
      ["New leads per day", int(num(data, "contacted_per_day"))],
      ["Leads counted", int(num(data, "counted_leads"))],
    ],
    subtitle: show(data, "campaign"),
    title: "Lead runway",
  };
};

const compareClients: CardBuilder = (data) => {
  const clients = rows(data, "clients");

  return {
    chart: pieChart(
      "Replies by client",
      clients.map((client) => [show(client, "client"), num(client, "replied")])
    ),
    subtitle: plural(clients.length, "client"),
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT],
      headers: [
        "Client",
        "Campaigns",
        "Sent",
        "Replies",
        "Reply rate",
        "Positive",
      ],
      rows: clients.map((client) => [
        show(client, "client"),
        int(num(client, "campaigns")),
        int(num(client, "sent")),
        int(num(client, "replied")),
        pct(num(client, "reply_rate")),
        int(num(client, "positive")),
      ]),
    },
    title: "Clients side by side",
  };
};

const crossChannelLead: CardBuilder = (data) => {
  const timeline = rows(data, "timeline");
  const records = rows(data, "records");

  const inbound = timeline.filter(
    (message) => str(message, "direction") === "in"
  ).length;

  return {
    bullets: timeline
      .toReversed()
      .map(
        (message) =>
          `${day(str(message, "sent_at"))} · ${show(message, "channel")} · ${
            str(message, "direction") === "in" ? "**reply**" : "sent"
          }${quote(field(message, "body"))}`
      ),
    finding:
      bool(data, "found") === false
        ? "No record carries this identifier."
        : null,
    stats: [
      ["Lead records", int(records.length)],
      ["Tools", int(new Set(records.map((r) => show(r, "provider"))).size)],
      ["Messages sent", int(timeline.length - inbound)],
      ["Replies", int(inbound)],
    ],
    subtitle: people(data, "identifiers"),
    title: "One person, every channel",
  };
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const windowLine = (window: JsonObject): string => {
  const days = strings(window, "days")
    .map((index) => WEEKDAYS[Number(index)] ?? "?")
    .join(" ");

  return `${days || DASH} · ${show(window, "from")}–${show(window, "to")} · ${show(
    window,
    "timezone"
  )}`;
};

const campaignSetup: CardBuilder = (data) => ({
  bullets: rows(data, "schedule").map((window) => windowLine(window)),
  stats: [
    ["Daily limit", int(num(data, "daily_limit"))],
    ["New leads per day", int(num(data, "daily_new_leads"))],
    ["Gap between sends", `${int(num(data, "gap_minutes"))} min`],
    ["Starts", show(data, "start_date")],
    ["Ends", show(data, "end_date")],
    ["Open tracking", yesNo(bool(data, "track_opens"))],
    ["Click tracking", yesNo(bool(data, "track_clicks"))],
    ["Reply stops sequence", yesNo(bool(data, "stop_on_reply"))],
    ["Auto-reply stops it", yesNo(bool(data, "stop_on_auto_reply"))],
    ["Plain text", yesNo(bool(data, "plain_text"))],
  ],
  subtitle: show(data, "campaign"),
  title: "Campaign setup",
});

const dns = (sender: JsonObject, record: string): string => {
  const passes = bool(child(sender, "dns"), record);

  if (passes === null) {
    return DASH;
  }

  return passes ? "✓" : "✗";
};

const deliverabilityCheck: CardBuilder = (data) => {
  const senders = rows(data, "senders");
  const broken = num(data, "with_problems") ?? 0;
  const screened = num(data, "screened") ?? senders.length;

  return {
    bullets: senders.flatMap((sender) => {
      const problems = strings(sender, "problems");

      return problems.length === 0
        ? []
        : [`🔴 **${show(sender, "address")}**: ${problems.join("; ")}`];
    }),
    finding: verdict(
      screened,
      broken === 0
        ? null
        : `🔴 ${int(broken)} of ${plural(screened, "sender")} ${noun(broken, "has", "have")} a problem.`,
      `No problem found on ${plural(screened, "sender")}.`
    ),
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
      rows: senders.map((sender) => [
        show(sender, "address"),
        dns(sender, "spf"),
        dns(sender, "dkim"),
        dns(sender, "dmarc"),
        dns(sender, "mx"),
        yesNo(bool(sender, "connected")),
        pct(num(sender, "warmup_spam_rate")),
      ]),
    },
    title: "Deliverability check",
  };
};

const audienceLists: CardBuilder = (data) => {
  const lists = rows(data, "lists");

  return {
    subtitle: plural(lists.length, "list"),
    table: {
      align: [LEFT, LEFT, RIGHT, LEFT],
      headers: ["List", "Kind", "Size", "Created"],
      rows: lists.map((list) => [
        show(list, "name"),
        show(list, "kind"),
        int(num(list, "size")),
        day(str(list, "created_at")),
      ]),
    },
    title: "Audience lists",
  };
};

const vendorRead: CardBuilder = (data) => {
  const reads = Object.keys(child(data, "reads"));

  return reads.length > 0
    ? {
        bullets: reads.map((name) => `\`${name.replaceAll("`", "'")}\``),
        subtitle: plural(reads.length, "read"),
        title: "Vendor reads on offer",
      }
    : {
        finding:
          "The vendor's own response is not drawn on a card: it is raw, not normalized, and may hold text written by prospects. Read it from the tool result.",
        title: "Vendor read",
      };
};

export const TOOL_CARDS: ReadonlyMap<string, CardBuilder> = new Map([
  ["audience_lists", audienceLists],
  ["campaign_overview", campaignOverview],
  ["campaign_setup", campaignSetup],
  ["campaign_trend", campaignTrend],
  ["compare_clients", compareClients],
  ["cross_channel_lead", crossChannelLead],
  ["deliverability_check", deliverabilityCheck],
  ["lead_runway", leadRunway],
  ["reply_samples", replySamples],
  ["sender_health", senderHealth],
  ["vendor_read", vendorRead],
  ["winning_steps", winningSteps],
]);
