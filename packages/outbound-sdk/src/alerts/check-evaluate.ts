// Evaluates a data check against what was read: stats rows, senders, or an
// insight's answer. It reads nothing and remembers nothing. Whether a check
// already fired, recovery and delivery are the caller's (or SendLens's).

import { OutboundError } from "../internal/errors.ts";
import { percentOf } from "../internal/numbers.ts";
import { measure } from "./check-measure.ts";
import type { CheckNumbers, CheckRead, Measurement } from "./check-measure.ts";
import { CHECK_METRICS } from "./check-schema.ts";
import type {
  Check,
  CheckMetric,
  CheckMetricName,
  CheckOp,
} from "./check-schema.ts";
import { describeIssues, validateCheck } from "./check-validate.ts";
import type { Alert, AlertRule } from "./plugin.ts";

/** One subject that broke the check, with the numbers that broke it. */
export interface CheckBreach extends Alert {
  readonly metric: CheckMetricName;
  readonly op: CheckOp;
  /** What was measured. */
  readonly value: number | string;
  /** The check's `value`. */
  readonly threshold: number | string;
  readonly day: string | null;
  /** The counts behind `value`, such as `{ bounced: 18, sent: 200 }`. */
  readonly numbers: CheckNumbers;
}

export interface CheckResult {
  /** The check's `name`, or its metric when it has none. */
  readonly check: string;
  /**
   * `fail` when at least one subject broke the check. `pass` when none did,
   * including when nothing could be measured (see `checked`). `not_checked`
   * when the input is not what the metric reads, or is another client's.
   */
  readonly status: "fail" | "not_checked" | "pass";
  /** Every subject that broke it. Empty unless `status` is `fail`. */
  readonly breaches: readonly CheckBreach[];
  /** Subjects measured and compared. */
  readonly checked: number;
  /** Subjects seen but not measured: too few sends, a missing count, an unknown status, a day before the window. */
  readonly skipped: number;
  /** Why the check did not run, for `not_checked`. Otherwise `null`. */
  readonly reason: string | null;
}

export interface EvaluateCheckOptions {
  /** The client the input belongs to, for a check scoped to a client. */
  readonly client?: string | undefined;
  /** The moment a `window` counts back from. Defaults to now. */
  readonly now?: Date | number | string | undefined;
}

const DAY_MS = 86_400_000;

const DEFAULT_MIN_SENT = 50;

const OP_WORDS: Readonly<Record<CheckOp, string>> = {
  "!=": "not",
  "<": "below",
  "<=": "at or below",
  "==": "equal to",
  ">": "above",
  ">=": "at or above",
};

/** Throws `Invalid` with every problem and its fix when the input is not a check. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the boundary: a check arrives as parsed JSON and is validated here
export const parseCheck = (input: unknown): Check => {
  const validation = validateCheck(input);

  if (!validation.ok) {
    throw new OutboundError(
      "Invalid",
      `The check is not valid:\n${describeIssues(validation.issues)}`
    );
  }

  return validation.check;
};

const breaks = (
  op: CheckOp,
  value: number | string,
  limit: number | string
): boolean => {
  switch (op) {
    case "==": {
      return value === limit;
    }

    case "!=": {
      return value !== limit;
    }

    case ">": {
      return value > limit;
    }

    case ">=": {
      return value >= limit;
    }

    case "<": {
      return value < limit;
    }

    default: {
      return value <= limit;
    }
  }
};

const shown = (metric: CheckMetric, value: number | string): string => {
  // A status is a string; every other unit is a number.
  if (metric.unit === "status") {
    return String(value);
  }

  const amount = Number(value);

  if (metric.unit === "rate") {
    return percentOf(amount);
  }

  const rounded = String(Math.round(amount * 10) / 10);

  return metric.unit === "count" ? rounded : `${rounded} ${metric.unit}`;
};

const inScope = (check: Check, reading: Measurement): boolean => {
  const { campaign, person, sender } = check.scope ?? {};

  return (
    (campaign === undefined || reading.campaign === campaign) &&
    (sender === undefined || reading.sender === sender) &&
    (person === undefined || reading.person === person)
  );
};

const fromDayOf = (
  check: Check,
  now: EvaluateCheckOptions["now"]
): string | null => {
  if (check.window === undefined) {
    return null;
  }

  const end = new Date(now ?? Date.now()).getTime();

  if (Number.isNaN(end)) {
    throw new OutboundError(
      "Invalid",
      `now is not a date: ${String(now)}. Pass a Date, milliseconds or an ISO 8601 string`
    );
  }

  return new Date(end - (check.window.days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
};

const notChecked = (name: string, reason: string): CheckResult => ({
  breaches: [],
  check: name,
  checked: 0,
  reason,
  skipped: 0,
  status: "not_checked",
});

const clientMismatch = (
  check: Check,
  client: string | undefined
): string | null => {
  const wanted = check.scope?.client;

  if (wanted === undefined || wanted === client) {
    return null;
  }

  return client === undefined
    ? `The check is scoped to client "${wanted}". Pass { client: "${wanted}" } with that client's read`
    : `The check is scoped to client "${wanted}", and this read is "${client}"'s`;
};

/**
 * Checks a data check against what was read and returns pass or fail with
 * the exact numbers that broke it. Throws `Invalid` for a malformed check,
 * listing each problem and its fix.
 */
export const evaluateCheck = (
  input: Check,
  read: CheckRead,
  options: EvaluateCheckOptions = {}
): CheckResult => {
  const check = parseCheck(input);
  const name = check.name ?? check.metric;
  const metric: CheckMetric = CHECK_METRICS[check.metric];
  const mismatch = clientMismatch(check, options.client);

  if (mismatch !== null) {
    return notChecked(name, mismatch);
  }

  const readings = measure(check.metric, metric.reads, read, {
    fromDay: fromDayOf(check, options.now),
    minSent: check.min_sent ?? DEFAULT_MIN_SENT,
  });

  if (!readings.ok) {
    return notChecked(name, readings.reason);
  }

  const measured = readings.readings.measured.filter((reading) =>
    inScope(check, reading)
  );

  const breaches = measured
    .filter((reading) => breaks(check.op, reading.value, check.value))
    .map((reading): CheckBreach => ({
      day: reading.day,
      message: `${check.metric} is ${shown(metric, reading.value)}, ${OP_WORDS[check.op]} ${shown(metric, check.value)}`,
      metric: check.metric,
      numbers: reading.numbers,
      op: check.op,
      rule: name,
      subject: reading.subject,
      subjectName: reading.subjectName,
      threshold: check.value,
      value: reading.value,
    }));

  return {
    breaches,
    check: name,
    checked: measured.length,
    reason: null,
    skipped: readings.readings.skipped,
    status: breaches.length > 0 ? "fail" : "pass",
  };
};

/**
 * A data check as an `AlertRule`, for the `alerts` plugin. Only a check on
 * records (stats rows or senders) can be a rule; an insight's check is run
 * with `evaluateCheck` on that insight's answer.
 */
export const checkRule = (
  input: Check,
  options: EvaluateCheckOptions = {}
): AlertRule => {
  const check = parseCheck(input);
  const { reads } = CHECK_METRICS[check.metric];

  if (reads !== "stats" && reads !== "senders") {
    throw new OutboundError(
      "Invalid",
      `${check.metric} reads a ${reads} answer, not records, so it cannot be an alert rule. Call evaluateCheck(check, await outbound.insights.${reads}(...)) instead`
    );
  }

  return {
    check: (record) =>
      evaluateCheck(check, record, options).breaches[0] ?? null,
    name: check.name ?? check.metric,
    state: reads === "senders",
  };
};
