// Cards for the copy and sequence insights.

import type { JsonObject } from "../internal/json.ts";
import { seriesChart } from "./content.ts";
import {
  bool,
  child,
  clip,
  DASH,
  int,
  num,
  pct,
  plural,
  rows,
  show,
  str,
  waiting,
  words,
  yesNo,
} from "./format.ts";
import { flagged, LEFT, RIGHT, verdict, withInterval } from "./parts.ts";
import type { CardBuilder } from "./tool-cards.ts";

const stepFunnel: CardBuilder = (data) => {
  const steps = rows(data, "steps");
  const loose = num(child(data, "unattributed"), "rows") ?? 0;

  return {
    chart: seriesChart(
      "bar",
      "Replies by step",
      "Replies",
      steps.map((step) => [`Step ${show(step, "step")}`, num(step, "replies")])
    ),
    finding: str(data, "finding"),
    notes:
      loose > 0
        ? [`${plural(loose, "stats row")} could not be tied to a step.`]
        : [],
    subtitle: show(data, "campaign"),
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT, LEFT],
      headers: [
        "Step",
        "Sent",
        "Replies",
        "Reply rate",
        "Share of replies",
        "Earns its place",
      ],
      rows: steps.map((step) => [
        show(step, "step"),
        int(num(step, "sent")),
        int(num(step, "replies")),
        withInterval(step, "replyRate", "replyRateInterval"),
        pct(num(step, "shareOfReplies")),
        yesNo(bool(step, "earnsPlace")),
      ]),
    },
    title: "Step funnel",
  };
};

const VERDICT_MARKS = new Map([
  ["no_difference_yet", "🟡"],
  ["too_little_data", "⚪"],
  ["winner", "🟢"],
]);

const verdictLine = (step: JsonObject): string =>
  `${VERDICT_MARKS.get(show(step, "verdict")) ?? "⚪"} **Step ${show(
    step,
    "step"
  )}**: ${show(step, "reason")}`;

const variantTest: CardBuilder = (data) => {
  const totals = child(data, "totals");
  const steps = rows(data, "steps");

  return {
    bullets: steps.map((step) => verdictLine(step)),
    finding:
      bool(data, "variantStatsReported") === false
        ? "The vendor does not report results by variant for this campaign."
        : `${plural(num(totals, "winners") ?? 0, "step")} with a real winner out of ${int(
            num(totals, "stepsTested")
          )} tested.`,
    stats: [
      ["Winners", int(num(totals, "winners"))],
      ["No difference yet", int(num(totals, "noDifferenceYet"))],
      ["Too little data", int(num(totals, "tooLittleData"))],
      ["Metric", words(show(data, "metric"))],
    ],
    subtitle: show(data, "campaign"),
    table: {
      align: [LEFT, LEFT, RIGHT, RIGHT],
      headers: ["Step", "Variant", "Sent", "Rate"],
      rows: steps.flatMap((step) =>
        rows(step, "variants").map((variant) => [
          show(step, "step"),
          `${show(variant, "variantKey")}${
            str(step, "leader") === str(variant, "variantKey") ? " ★" : ""
          }`,
          int(num(variant, "sent")),
          withInterval(variant, "rate", "interval"),
        ])
      ),
    },
    title: "Variant test",
  };
};

const copyAudit: CardBuilder = (data) => {
  const severity = child(data, "bySeverity");

  return {
    bullets: rows(data, "findings").map((finding) =>
      flagged(
        finding,
        `Step ${show(finding, "step")} ${show(finding, "variantKey")}: `
      )
    ),
    finding: verdict(
      num(data, "variantsChecked"),
      bool(data, "clean") === true
        ? null
        : `${plural(rows(data, "findings").length, "problem")} found in the copy.`,
      "No problem found in the copy."
    ),
    stats: [
      ["High", int(num(severity, "high"))],
      ["Medium", int(num(severity, "medium"))],
      ["Low", int(num(severity, "low"))],
      ["Steps checked", int(num(data, "stepsChecked"))],
      ["Variants checked", int(num(data, "variantsChecked"))],
    ],
    subtitle: show(data, "campaign"),
    title: "Copy audit",
  };
};

const copyLabel = (piece: JsonObject): string =>
  clip(str(piece, "subject") ?? str(piece, "bodyPreview") ?? DASH, 60);

const copyReuse: CardBuilder = (data) => {
  const reused = rows(data, "reused");
  const bestCopy = child(data, "bestCopy");

  return {
    bullets: reused.map((piece) => show(piece, "finding")),
    finding:
      str(bestCopy, "contentHash") === null
        ? "No copy has enough results to name a best one."
        : `Best copy: "${copyLabel(bestCopy)}" at ${withInterval(
            bestCopy,
            "replyRate",
            "replyRateInterval"
          )}.`,
    stats: [
      ["Copy used more than once", int(reused.length)],
      ["Pieces of copy", int(num(data, "piecesOfCopy"))],
      ["Campaigns read", int(num(data, "campaignsRead"))],
    ],
    table: {
      align: [LEFT, RIGHT, RIGHT, RIGHT, RIGHT],
      headers: ["Copy", "Campaigns", "Sent", "Reply rate", "Spread"],
      rows: reused.map((piece) => [
        copyLabel(piece),
        int(num(piece, "campaigns")),
        int(num(piece, "sent")),
        pct(num(piece, "replyRate")),
        pct(num(piece, "spread")),
      ]),
    },
    title: "Copy reuse",
  };
};

const replyTiming: CardBuilder = (data) => {
  const timing = child(data, "timeToReply");
  const replies = child(data, "replies");
  const topHour = num(replies, "topHour");

  return {
    chart: seriesChart(
      "bar",
      "Replies by weekday",
      "Replies",
      rows(replies, "byWeekday").map((entry) => [
        words(show(entry, "weekday")).slice(0, 3),
        num(entry, "count"),
      ])
    ),
    finding:
      str(replies, "topWeekday") === null
        ? "No replies to time yet."
        : `Most replies arrive on ${words(show(replies, "topWeekday"))}${
            topHour === null ? "" : ` around ${int(topHour)}:00`
          }.`,
    stats: [
      ["Median time to reply", waiting(num(timing, "medianHours"))],
      ["75% reply within", waiting(num(timing, "p75Hours"))],
      ["90% reply within", waiting(num(timing, "p90Hours"))],
      ["Within 1 hour", pct(num(timing, "within1Hour"))],
      ["Within 24 hours", pct(num(timing, "within24Hours"))],
      ["Replies timed", int(num(timing, "sample"))],
    ],
    subtitle: str(data, "campaign"),
    title: "Reply timing",
  };
};

export const COPY_CARDS: ReadonlyMap<string, CardBuilder> = new Map([
  ["copy_audit", copyAudit],
  ["copy_reuse", copyReuse],
  ["reply_timing", replyTiming],
  ["step_funnel", stepFunnel],
  ["variant_test", variantTest],
]);
