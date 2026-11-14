// Input checks. A wrong call throws `Invalid` before any plugin or request.

import type { TimeRange } from "../adapter.ts";
import { OutboundError } from "../errors.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const invalid = (message: string): OutboundError =>
  new OutboundError("Invalid", message);

/** An inclusive ISO 8601 UTC timestamp, or `undefined`. */
const normalizeInstant = (
  value: string | undefined,
  name: string
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    throw invalid(
      `${name} must be an ISO 8601 date or timestamp, got "${value}"`
    );
  }

  return new Date(time).toISOString();
};

export const normalizeRange = (range: TimeRange): TimeRange => {
  const since = normalizeInstant(range.since, "since");
  const until = normalizeInstant(range.until, "until");

  if (since !== undefined && until !== undefined && since > until) {
    throw invalid("since must not be after until");
  }

  return { since, until };
};

export const assertDay = (
  value: string | undefined,
  name: string
): string | undefined => {
  if (
    value !== undefined &&
    (!DATE.test(value) || Number.isNaN(Date.parse(value)))
  ) {
    throw invalid(`${name} must be a date in YYYY-MM-DD form, got "${value}"`);
  }

  return value;
};

export const assertLimit = (limit: number | undefined): number | undefined => {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw invalid(`limit must be a positive integer, got ${limit}`);
  }

  return limit;
};

export const assertId = (id: string, what: string): string => {
  if (id.trim() === "") {
    throw invalid(`${what} id must not be empty`);
  }

  return id;
};
