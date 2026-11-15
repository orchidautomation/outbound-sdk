// How a card writes a value. Everything a card shows was read from a tool
// result: a count the vendor did not report is a dash, never a zero, and text
// that came from a vendor or a prospect is made inert before it is shown.

import {
  count,
  field,
  flag,
  isJsonObject,
  list,
  objects,
  text,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { noun, percentOf, points, shownKey } from "../internal/plural.ts";

export { noun } from "../internal/plural.ts";

/** What a card shows for a value the vendor does not report. */
export const DASH = "—";

const ZERO_WIDTH_SPACE = "​";

/**
 * Makes vendor or prospect text inert in a chat message. A chat platform
 * reads `<!channel>` as a mention and `[text](url)` as a link, so angle
 * brackets become look-alikes, a link loses its join, a code fence is broken
 * and a broadcast keyword is split.
 */
export const safe = (value: string): string =>
  value
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .replaceAll("](", "] (")
    .replaceAll("```", "'''")
    .replaceAll(
      /@(?<word>channel|everyone|here)/giu,
      `@${ZERO_WIDTH_SPACE}$<word>`
    );

/** Cuts text to `max` characters, ending with an ellipsis when it was cut. */
export const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** A string field, made inert, or `null` when it is missing or empty. */
export const str = (value: Json | undefined, key: string): string | null => {
  const raw = text(field(value, key));

  return raw === null ? null : safe(raw);
};

/** A string field for display: made inert, or a dash. */
export const show = (value: Json | undefined, key: string): string =>
  str(value, key) ?? DASH;

/** A campaign's name: `campaignName`, or `name` in a result stored before it. */
export const campaignNameOf = (value: Json | undefined): string =>
  str(value, "campaignName") ?? show(value, "name");

export const num = (value: Json | undefined, key: string): number | null =>
  count(field(value, key));

export const bool = (value: Json | undefined, key: string): boolean | null =>
  flag(field(value, key));

export const rows = (value: Json | undefined, key: string): JsonObject[] =>
  objects(field(value, key));

/** A list of strings, each made inert. */
export const strings = (value: Json | undefined, key: string): string[] =>
  list(field(value, key)).flatMap((item) => {
    const raw = text(item);

    return raw === null ? [] : [safe(raw)];
  });

/** Person keys as a person reads them: `jo@example.com · linkedin.com/in/jo`, or `null`. */
export const people = (value: Json | undefined, key: string): string | null =>
  strings(value, key)
    .map((each) => shownKey(each))
    .join(" · ") || null;

export const child = (value: Json | undefined, key: string): JsonObject => {
  const found = field(value, key);

  return isJsonObject(found) ? found : {};
};

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A count with thousands separators, or a dash. */
export const int = (value: number | null): string =>
  value === null ? DASH : grouped.format(value);

/**
 * A step as a person counts it, from 1. A tool or insight counts steps from
 * 0, as the vendor does, so step `0` is shown as `1`.
 */
export const stepOf = (value: Json | undefined, key: string): string => {
  const index = num(value, key);

  return index === null ? DASH : int(index + 1);
};

/** A list of steps as a person counts them, from 1: `1, 3`. */
export const stepsOf = (value: Json | undefined, key: string): string =>
  list(field(value, key))
    .flatMap((index) => {
      const at = count(index);

      return at === null ? [] : [int(at + 1)];
    })
    .join(", ");

/** A rate between 0 and 1 as a percentage with one decimal, or a dash. */
export const pct = (rate: number | null): string =>
  rate === null ? DASH : percentOf(rate);

/** A rate with its interval, as `4.2% (3.1–5.6%)`. */
export const pctRange = (
  rate: number | null,
  low: number | null,
  high: number | null
): string =>
  rate === null || low === null || high === null
    ? pct(rate)
    : `${pct(rate)} (${points(low)}–${pct(high)})`;

export const yesNo = (value: boolean | null): string => {
  if (value === null) {
    return DASH;
  }

  return value ? "Yes" : "No";
};

/** The day of an ISO timestamp, as `2026-11-14`, or a dash. */
export const day = (value: string | null): string =>
  value === null ? DASH : value.slice(0, 10);

/** Hours as `5h` or, from two days up, `3d`. */
export const waiting = (hours: number | null): string => {
  if (hours === null) {
    return DASH;
  }

  return hours >= 48 ? `${Math.floor(hours / 24)}d` : `${Math.round(hours)}h`;
};

/**
 * `1 campaign`, `3 campaigns`, with thousands separators, and `— campaigns`
 * for a count the vendor does not report. Pass `many` when adding an `s` is wrong.
 */
export const plural = (
  amount: number | null,
  word: string,
  many = `${word}s`
): string => `${int(amount)} ${noun(amount ?? 0, word, many)}`;

const SEVERITY_MARKS = new Map([
  ["high", "🔴"],
  ["low", "⚪"],
  ["medium", "🟡"],
  ["ok", "🟢"],
]);

/** A coloured dot for `high`, `medium`, `low` or `ok`; white for anything else. */
export const mark = (severity: string | null): string =>
  SEVERITY_MARKS.get(severity ?? "") ?? "⚪";

/** A snake_case or camelCase name as words: `reply_rate` becomes `Reply rate`. */
export const words = (name: string): string => {
  const spaced = name
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .replaceAll("_", " ")
    .toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
