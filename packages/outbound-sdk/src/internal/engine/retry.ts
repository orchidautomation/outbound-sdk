import { count, field, isJsonObject } from "../json.ts";
import type { Json } from "../json.ts";

export interface RetryPolicy {
  /** Retries after the first attempt. */
  readonly max: number;
  /** Delay before retry `attempt` (starting at 1), given a random number in [0, 1). */
  readonly backoff: (attempt: number, random: number) => number;
}

const BASE_MS = 1000;
const CAP_MS = 60_000;

/** Exponential backoff with full jitter: 1 s base, 60 s cap. */
export const fullJitterBackoff = (attempt: number, random: number): number =>
  Math.floor(random * Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1)));

export const DEFAULT_RETRIES = 4;

export type RetriesOption =
  | number
  | {
      readonly max: number;
      readonly backoff?: RetryPolicy["backoff"] | undefined;
    };

export const resolveRetryPolicy = (
  option: RetriesOption | undefined
): RetryPolicy => {
  if (option === undefined) {
    return { backoff: fullJitterBackoff, max: DEFAULT_RETRIES };
  }

  if (isRetryCount(option)) {
    return { backoff: fullJitterBackoff, max: Math.max(0, Math.floor(option)) };
  }

  return {
    backoff: option.backoff ?? fullJitterBackoff,
    max: Math.max(0, Math.floor(option.max)),
  };
};

const isRetryCount = (option: RetriesOption): option is number =>
  typeof option === "number";

const secondsFromBody = (body: Json | undefined): number | undefined => {
  if (!isJsonObject(body)) {
    return undefined;
  }

  for (const key of ["retry_after", "retryAfter", "retry_after_seconds"]) {
    const seconds = count(field(body, key));

    if (seconds !== null) {
      return seconds;
    }
  }

  return undefined;
};

/**
 * How long the vendor asked us to wait: `Retry-After` as seconds or an HTTP
 * date, or seconds found in the response body.
 */
export const parseRetryAfter = (
  headers: Headers,
  body: Json | undefined,
  now: number
): number | undefined => {
  const header = headers.get("retry-after");

  if (header !== null && header.trim() !== "") {
    const seconds = Number(header);

    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.ceil(seconds * 1000));
    }

    const date = Date.parse(header);

    if (!Number.isNaN(date)) {
      return Math.max(0, date - now);
    }
  }

  const seconds = secondsFromBody(body);

  return seconds === undefined
    ? undefined
    : Math.max(0, Math.ceil(seconds * 1000));
};

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504,
]);

export const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUSES.has(status);
