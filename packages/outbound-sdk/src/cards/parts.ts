// Pieces the insight cards share: how a measured rate, a set of totals and a
// severity are written.

import type { Json, JsonObject } from "../internal/json.ts";
import type { Stat } from "./content.ts";
import {
  bool,
  child,
  int,
  mark,
  num,
  pctRange,
  plural,
  show,
  words,
} from "./format.ts";

export const LEFT = "left";
export const RIGHT = "right";

/** A rate with `low` and `high` beside it, as the ops insights report one. */
export const measured = (value: Json | undefined): string =>
  pctRange(num(value, "rate"), num(value, "low"), num(value, "high"));

/** A rate with an `interval` object beside it, as the copy insights report one. */
export const withInterval = (
  value: JsonObject,
  rateKey: string,
  intervalKey: string
): string => {
  const interval = child(value, intervalKey);

  return pctRange(
    num(value, rateKey),
    num(interval, "low"),
    num(interval, "high")
  );
};

/** Sent, replies, positive and bounced, as fields. */
export const totalStats = (totals: Json | undefined): Stat[] => [
  ["Sent", int(num(totals, "sent"))],
  ["Replies", int(num(totals, "replied"))],
  ["Positive", int(num(totals, "positive"))],
  ["Bounced", int(num(totals, "bounced"))],
];

/** `🔴 finding` for an item with a `severity` and a `finding`. */
export const flagged = (item: JsonObject, prefix = ""): string =>
  `${mark(show(item, "severity"))} ${prefix}${show(item, "finding")}`;

/** The counts in an object as fields, biggest first, zeroes left out. */
export const countStats = (counts: JsonObject): Stat[] =>
  Object.keys(counts)
    .flatMap((key) => {
      const amount = num(counts, key);

      return amount === null || amount === 0 ? [] : [[key, amount] as const];
    })
    .toSorted((left, right) => right[1] - left[1])
    .map(([key, amount]) => [words(key), int(amount)]);

/**
 * The headline of a check. Says so when nothing was read, since a check that
 * read nothing has not passed.
 */
export const verdict = (
  checked: number | null,
  problem: string | null,
  clean: string
): string => {
  if (checked === null || checked === 0) {
    return "⚪ Nothing had enough data to check.";
  }

  return problem ?? `🟢 ${clean}`;
};

export const range = (period: Json | undefined): string =>
  `${show(period, "from")} to ${show(period, "to")}`;

/** `4.2%` as a chart value: one decimal, or `null`. */
export const percentPoint = (rate: number | null): number | null =>
  rate === null ? null : Math.round(rate * 1000) / 10;

/** Says an answer stopped at `max_campaigns` with more campaigns left, or nothing. */
export const campaignsCapped = (data: Json | undefined): string[] =>
  bool(data, "moreCampaignsExist") === true
    ? [
        `🟡 Stopped at ${plural(num(data, "campaignsRead") ?? 0, "campaign")} read (max_campaigns); more exist and are not in this answer.`,
      ]
    : [];
