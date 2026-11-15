// Cards for the operations insights: what changed, what is wrong and what to
// do about it.

import type { Json, JsonObject } from "../internal/json.ts";
import { pieChart, seriesChart } from "./content.ts";
import type { Stat } from "./content.ts";
import {
  bool,
  child,
  DASH,
  int,
  num,
  pct,
  plural,
  rows,
  show,
  str,
  strings,
  words,
} from "./format.ts";
import {
  campaignsCapped,
  flagged,
  LEFT,
  measured,
  percentPoint,
  range,
  RIGHT,
  totalStats,
  verdict,
} from "./parts.ts";
import type { CardBuilder } from "./tool-cards.ts";

const anomalies: CardBuilder = (data) => {
  const found = rows(data, "anomalies");

  const untested = rows(data, "metrics").filter(
    (metric) => str(metric, "reason") !== null
  );

  return {
    bullets: found.map(
      (anomaly) =>
        `${str(anomaly, "direction") === "above" ? "🔺" : "🔻"} ${show(anomaly, "finding")}`
    ),
    finding: verdict(
      rows(data, "metrics").filter(
        (metric) => bool(metric, "testable") === true
      ).length,
      found.length === 0
        ? null
        : `🟡 Days that stand out from the baseline: ${int(found.length)}.`,
      "No day stands out from its own baseline."
    ),
    notes: untested.map(
      (metric) => `${words(show(metric, "metric"))}: ${show(metric, "reason")}`
    ),
    // The answer names a campaign by its ref only, so the ref is a value, not a heading.
    stats: [
      [
        "Scope",
        str(data, "scope") === "workspace"
          ? "Whole workspace"
          : show(data, "scope"),
      ],
    ],
    subtitle: range(child(data, "period")),
    title: "Anomalies",
  };
};

const rateStats = (rates: Json | undefined): Stat[] => [
  ["Reply rate", measured(child(rates, "replyRate"))],
  ["Positive rate", measured(child(rates, "positiveRate"))],
  ["Bounce rate", measured(child(rates, "bounceRate"))],
];

const campaignDiagnosis: CardBuilder = (data) => ({
  bullets: rows(data, "findings").map(
    (finding) => `${flagged(finding)} Next: ${show(finding, "next")}`
  ),
  finding: str(data, "summary"),
  notes: strings(data, "notChecked").map((check) => `Not checked: ${check}`),
  stats: [
    ...totalStats(child(data, "totals")),
    ...rateStats(child(data, "rates")),
  ],
  subtitle: `${show(data, "name")} · ${show(data, "status")} · ${show(data, "channel")}`,
  title: "Campaign diagnosis",
});

const campaignRanking: CardBuilder = (data) => {
  const ranked = rows(data, "ranked");
  const gap = child(data, "gap");
  const metric = words(show(data, "metric"));
  const [first] = ranked;

  return {
    bullets: campaignsCapped(data),
    chart: seriesChart(
      "bar",
      `${metric} by campaign (%)`,
      `${metric} %`,
      ranked.map((campaign) => [
        show(campaign, "name"),
        percentPoint(num(campaign, "rate")),
      ])
    ),
    finding:
      first === undefined
        ? "No campaign has enough sends to rank."
        : `${show(first, "name")} ranks first at ${pct(num(first, "rate"))}.`,
    notes:
      rows(data, "tooFewSends").length > 0
        ? [
            `${plural(rows(data, "tooFewSends").length, "campaign")} left out: too few sends to rank.`,
          ]
        : [],
    stats: [
      ["Top", pct(num(gap, "top"))],
      ["Median", pct(num(gap, "median"))],
      ["Gap", pct(num(gap, "difference"))],
    ],
    subtitle: `${metric}, ${show(data, "better")} is better`,
    table: {
      align: [RIGHT, LEFT, RIGHT, RIGHT],
      headers: ["#", "Campaign", "Sent", metric],
      rows: ranked.map((campaign) => [
        int(num(campaign, "rank")),
        show(campaign, "name"),
        int(num(campaign, "sent")),
        measured(campaign),
      ]),
    },
    title: "Campaign ranking",
  };
};

const channelMix: CardBuilder = (data) => {
  const channels = rows(data, "channels");

  return {
    bullets: campaignsCapped(data),
    chart: pieChart(
      "Replies by channel",
      channels.map((channel) => [
        words(show(channel, "channel")),
        num(channel, "replied"),
      ])
    ),
    finding: str(data, "finding"),
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT],
      headers: [
        "Channel",
        "Campaigns",
        "Sent",
        "Replies",
        "Reply rate",
        "Positive rate",
      ],
      rows: channels.map((channel) => [
        words(show(channel, "channel")),
        int(num(channel, "campaigns")),
        int(num(channel, "sent")),
        int(num(channel, "replied")),
        measured(child(channel, "replyRate")),
        measured(child(channel, "positiveRate")),
      ]),
    },
    title: "Channel mix",
  };
};

type Write = (value: number | null) => string;

/** `1,200 (was 1,000)` for one number in two periods. */
const versus = (comparison: JsonObject, key: string, write: Write): string => {
  const now = num(child(comparison, "current"), key);
  const before = num(child(comparison, "previous"), key);

  return now === null && before === null
    ? DASH
    : `${write(now)} (was ${write(before)})`;
};

const comparisonStats = (comparison: JsonObject): Stat[] => [
  ["Sent", versus(comparison, "sent", int)],
  ["Replies", versus(comparison, "replied", int)],
  // A period's replies are divided by messages sent (`replyRateBasis`).
  ["Replies per send", versus(comparison, "replyRate", pct)],
  ["Positive", versus(comparison, "positive", int)],
  ["Bounce rate", versus(comparison, "bounceRate", pct)],
];

const VERDICT_MARKS = new Map([
  ["down", "🔻"],
  ["no_real_change", "▪️"],
  ["up", "🔺"],
]);

const changeOf = (comparison: JsonObject): string =>
  `${VERDICT_MARKS.get(show(comparison, "verdict")) ?? "⚪"} ${words(
    show(comparison, "verdict")
  ).toLowerCase()}`;

const periodComparison: CardBuilder = (data) => {
  const total = child(data, "total");

  return {
    bullets: campaignsCapped(data),
    finding: str(total, "finding"),
    stats: comparisonStats(total),
    subtitle: `${range(child(data, "current"))}, against ${range(child(data, "previous"))}`,
    table: {
      align: [LEFT, RIGHT, RIGHT, LEFT],
      headers: ["Campaign", "Replies per send now", "Before", "Change"],
      rows: rows(data, "campaigns").map((campaign) => [
        show(campaign, "name"),
        pct(num(child(campaign, "current"), "replyRate")),
        pct(num(child(campaign, "previous"), "replyRate")),
        changeOf(campaign),
      ]),
    },
    title: `Last ${plural(num(data, "days") ?? 0, "day")} against the ${int(num(data, "days"))} before`,
  };
};

const estimate = (value: Json | undefined): string => {
  const expected = num(value, "expected");

  return expected === null
    ? DASH
    : `${int(Math.round(expected))} (${int(num(value, "low"))}–${int(num(value, "high"))})`;
};

const pipelineForecast: CardBuilder = (data) => {
  const days = num(data, "daysLeft");

  return {
    finding: str(data, "finding"),
    notes: ["An estimate, not a count.", ...strings(data, "assumptions")],
    stats: [
      ["Leads left to contact", int(num(data, "remaining"))],
      ["Days of leads left", days === null ? DASH : plural(days, "day")],
      ["Contacted per day", int(num(data, "dailyContactRate"))],
      ["Expected replies", estimate(child(data, "expectedReplies"))],
      ["Expected positive", estimate(child(data, "expectedPositive"))],
      ["Reply rate so far", measured(child(data, "replyRate"))],
    ],
    subtitle: show(data, "name"),
    title: "Pipeline forecast",
  };
};

const tagName = (tag: JsonObject): string => str(tag, "tag") ?? "(no tag)";

const tagRollup: CardBuilder = (data) => {
  const tags = rows(data, "tags");

  return {
    bullets: campaignsCapped(data),
    chart: seriesChart(
      "bar",
      "Reply rate by tag (%)",
      "Reply rate %",
      tags.map((tag) => [
        tagName(tag),
        percentPoint(num(child(tag, "replyRate"), "rate")),
      ])
    ),
    subtitle: `${plural(num(data, "campaigns") ?? 0, "campaign")} · ${plural(tags.length, "tag")}`,
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT],
      headers: [
        "Tag",
        "Campaigns",
        "Sent",
        "Replies",
        "Reply rate",
        "Positive rate",
      ],
      rows: tags.map((tag) => [
        tagName(tag),
        int(num(tag, "campaigns")),
        int(num(tag, "sent")),
        int(num(tag, "replied")),
        measured(child(tag, "replyRate")),
        measured(child(tag, "positiveRate")),
      ]),
    },
    title: "Results by tag",
  };
};

const clientReport: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const actions = rows(data, "actions");

  return {
    bullets: [
      ...campaignsCapped(data),
      ...actions.map((action) => `👉 ${show(action, "action")}`),
    ],
    finding: str(totals, "finding"),
    notes: strings(data, "leftOut").map((part) => `Left out: ${part}`),
    stats: comparisonStats(totals),
    subtitle: `${plural(num(data, "campaigns") ?? 0, "campaign")} · ${range(child(data, "period"))}`,
    table: {
      align: [RIGHT, LEFT, RIGHT, RIGHT],
      headers: ["#", "Top campaigns", "Sent", "Replies per send"],
      rows: rows(data, "top").map((campaign) => [
        int(num(campaign, "rank")),
        show(campaign, "name"),
        int(num(campaign, "sent")),
        measured(campaign),
      ]),
    },
    title: "Client report",
  };
};

export const OPS_CARDS: ReadonlyMap<string, CardBuilder> = new Map([
  ["anomalies", anomalies],
  ["campaign_diagnosis", campaignDiagnosis],
  ["campaign_ranking", campaignRanking],
  ["channel_mix", channelMix],
  ["client_report", clientReport],
  ["period_comparison", periodComparison],
  ["pipeline_forecast", pipelineForecast],
  ["tag_rollup", tagRollup],
]);
