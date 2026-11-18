// What a command reads from its arguments: flag values, checked, and the
// walk options every listing shares.

import { OutboundError } from "../internal/errors.ts";
import { parseJson } from "../internal/json.ts";
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
