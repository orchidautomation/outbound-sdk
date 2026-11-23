// What a command reads from its arguments: flag values, checked, and the
// walk options every listing shares.

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, parseJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";

export interface CommandInput {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  /** Writes a line for the person to stderr, apart from the JSON on stdout. */
  readonly note: (text: string) => void;
  /** Writes one record to stdout as a JSON line, for `--jsonl`. */
  readonly emit?: ((record: Json) => void) | undefined;
}

export const text = (input: CommandInput, name: string): string | undefined => {
  const value = input.flags[name];

  return value === undefined || value === true || value === false
    ? undefined
    : value;
};

export const count = (
  input: CommandInput,
  name: string,
  fallback: number
): number => {
  const value = text(input, name);
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new OutboundError(
      "Invalid",
      `--${name} must be a positive whole number`
    );
  }

  return parsed;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * A date flag as an instant. Every date flag takes the same two forms: a
 * day, YYYY-MM-DD, which is that day's start in UTC, or an ISO 8601 date and
 * time with its offset. Anything else, `11/10/2026` included, is refused
 * with the same words.
 */
const dateOf = (input: CommandInput, name: string): Date | undefined => {
  const value = text(input, name);

  if (value === undefined) {
    return undefined;
  }

  const date = new Date(
    DAY.test(value) || DATE_TIME.test(value) ? Date.parse(value) : Number.NaN
  );

  // A day that does not exist, such as 2026-02-30, rolls over in Date.parse.
  if (
    Number.isNaN(date.getTime()) ||
    (DAY.test(value) && date.toISOString().slice(0, 10) !== value)
  ) {
    throw new OutboundError(
      "Invalid",
      `--${name} must be a day, YYYY-MM-DD, or an ISO 8601 date and time such as 2026-11-10T09:00:00Z, got "${value}"`
    );
  }

  return date;
};

/** A date flag where a command counts whole days: the UTC day it falls on, YYYY-MM-DD. */
export const dayFlag = (
  input: CommandInput,
  name: string
): string | undefined => dateOf(input, name)?.toISOString().slice(0, 10);

/** A date flag where a command keeps what is newer: the instant, ISO 8601 UTC. */
export const instantFlag = (
  input: CommandInput,
  name: string
): string | undefined => dateOf(input, name)?.toISOString();

/** A flag that takes one of a fixed set of words. Anything else is refused, never guessed. */
export const choice = <Value extends string>(
  input: CommandInput,
  name: string,
  allowed: readonly Value[]
): Value | undefined => {
  const value = text(input, name);
  const match = allowed.find((candidate) => candidate === value);

  if (value !== undefined && match === undefined) {
    throw new OutboundError(
      "Invalid",
      `--${name} must be one of: ${allowed.join(", ")}`
    );
  }

  return match;
};

export const BY = ["day", "total"] as const;
export const STATS_SCOPES = ["campaign", "sender", "workspace"] as const;

/**
 * The walk options every listing takes from the command line. Pages are
 * asked for at `--limit`'s size, which the adapter clamps to the vendor's
 * most, so a walk `--limit` stops ends on a page and resumes without
 * repeating a record. A walk the SDK filters (`filtered`) keeps the
 * vendor's page size, since a smaller page would cost more requests.
 */
interface WalkOptions {
  readonly cursor: string | undefined;
  readonly limit: number | undefined;
  readonly max: number;
}

export const walkOptions = (
  input: CommandInput,
  fallback = 50,
  filtered = false
): WalkOptions => {
  const max = count(input, "limit", fallback);

  return {
    cursor: text(input, "cursor"),
    limit: filtered ? undefined : max,
    max,
  };
};

/**
 * A note when the vendor cannot filter by date, so `--since` reads every
 * record and keeps the newer ones here: the walk costs as much as a full one.
 */
export const clientFiltered = (
  outbound: OutboundApi,
  capability: "leads.since" | "replies.since",
  since: string | undefined,
  input: CommandInput
): string[] => {
  if (since === undefined || outbound.capabilities[capability] !== "client") {
    return [];
  }

  const what = capability === "leads.since" ? "leads" : "replies";
  const note = `${outbound.provider} cannot filter ${what} by date, so --since reads every one and keeps those since ${since}: it costs as many requests as reading them all.`;
  input.note(note);

  return [note];
};

export const REPLIES_BY = ["person"] as const;

export const parseInput = (source: string | undefined): Json => {
  const parsed = source === undefined ? {} : parseJson(source);

  if (parsed === undefined) {
    throw new OutboundError("Invalid", "--input must be valid JSON");
  }

  return parsed;
};

/**
 * An insight's input: --input, with the campaign scope that --campaign-ids
 * (comma separated), --tag and --campaign-name give. A scope key given both
 * ways is refused rather than one quietly winning.
 */
export const insightInputOf = (input: CommandInput): Json => {
  const given = parseInput(text(input, "input"));
  const ids = text(input, "campaign-ids");
  const scope: [string, Json][] = [];

  if (ids !== undefined) {
    scope.push(["campaign_ids", ids.split(",").map((id) => id.trim())]);
  }

  for (const [key, flag] of [
    ["campaign_name", "campaign-name"],
    ["tag", "tag"],
  ] as const) {
    const value = text(input, flag);

    if (value !== undefined) {
      scope.push([key, value]);
    }
  }

  if (scope.length === 0) {
    return given;
  }

  if (!isJsonObject(given)) {
    throw new OutboundError(
      "Invalid",
      "--input must be a JSON object to take --campaign-ids, --tag or --campaign-name"
    );
  }

  const twice = scope.find(([key]) => Object.hasOwn(given, key));

  if (twice !== undefined) {
    throw new OutboundError(
      "Invalid",
      `${twice[0]} is given in --input and as --${twice[0].replace("_", "-")}: give it once`
    );
  }

  return { ...given, ...Object.fromEntries(scope) };
};

export const required = (
  input: CommandInput,
  index: number,
  what: string
): string => {
  const value = input.positionals[index];

  if (value === undefined) {
    throw new OutboundError("Invalid", `Missing ${what}`);
  }

  return value;
};
