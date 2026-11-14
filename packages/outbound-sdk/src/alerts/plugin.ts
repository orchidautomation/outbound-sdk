// outbound-sdk/alerts: fixed rules, checked after reads. A rule is plain
// arithmetic on what was just read; no model is involved. When a rule fires,
// your `notify` function is called. It is fire-and-forget: a notifier that
// fails cannot fail the read.

import type { MetricRow, Sender } from "../internal/entities.ts";
import { computeRates } from "../internal/metrics.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface Alert {
  /** The rule's name. */
  readonly rule: string;
  /** The ref of the campaign, sender or workspace it is about. */
  readonly subject: string;
  readonly message: string;
  /** What was measured. */
  readonly value: number | string | null;
  /** What it was compared with. */
  readonly threshold: number | string | null;
}

export interface AlertRule {
  readonly name: string;
  /** Returns an alert when the record breaks the rule, otherwise `null`. */
  readonly check: (record: OutboundRecord) => Alert | null;
}

export interface AlertsOptions {
  readonly rules: readonly AlertRule[];
  readonly notify: (alerts: readonly Alert[]) => void | Promise<void>;
}

export interface AlertsExtension {
  readonly alerts: {
    /** Checks records against the rules without notifying. */
    readonly evaluate: (records: readonly OutboundRecord[]) => Alert[];
  };
}

const isMetricRow = (record: OutboundRecord): record is MetricRow =>
  "scope" in record;

const isSender = (record: OutboundRecord): record is Sender =>
  "kind" in record && "dailyLimit" in record;

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export interface RateRuleOptions {
  /** Ignore rows with fewer sends than this, where a rate is noise. Defaults to 50. */
  readonly minSent?: number | undefined;
}

/** Fires when a row's bounce rate is above `threshold` (0 to 1). */
export const bounceRateAbove = (
  threshold: number,
  options: RateRuleOptions = {}
): AlertRule => ({
  check: (record) => {
    if (!isMetricRow(record) || (record.sent ?? 0) < (options.minSent ?? 50)) {
      return null;
    }

    const { value } = computeRates(record).bounceRate;

    return value !== null && value > threshold
      ? {
          message: `Bounce rate is ${percent(value)}, above ${percent(threshold)}`,
          rule: "bounce-rate-above",
          subject: record.scopeRef,
          threshold,
          value,
        }
      : null;
  },
  name: "bounce-rate-above",
});

/** Fires when a row's reply rate is below `threshold` (0 to 1). */
export const replyRateBelow = (
  threshold: number,
  options: RateRuleOptions = {}
): AlertRule => ({
  check: (record) => {
    if (!isMetricRow(record) || (record.sent ?? 0) < (options.minSent ?? 50)) {
      return null;
    }

    const { value } = computeRates(record).replyRate;

    return value !== null && value < threshold
      ? {
          message: `Reply rate is ${percent(value)}, below ${percent(threshold)}`,
          rule: "reply-rate-below",
          subject: record.scopeRef,
          threshold,
          value,
        }
      : null;
  },
  name: "reply-rate-below",
});

/** Fires for a sender that is paused, disconnected or in error. */
export const senderNotActive = (): AlertRule => ({
  check: (record) =>
    isSender(record) &&
    record.status !== "active" &&
    record.status !== "unknown"
      ? {
          message: `Sender is ${record.status}`,
          rule: "sender-not-active",
          subject: record.ref,
          threshold: "active",
          value: record.status,
        }
      : null,
  name: "sender-not-active",
});

/** Fires for a row that reported sends on a day with none: a sender gone quiet. */
export const noSends = (): AlertRule => ({
  check: (record) =>
    isMetricRow(record) && record.date !== null && record.sent === 0
      ? {
          message: `Nothing was sent on ${record.date}`,
          rule: "no-sends",
          subject: record.scopeRef,
          threshold: 1,
          value: 0,
        }
      : null,
  name: "no-sends",
});

const ignore = (): void => {
  // A notifier must never fail the read it reports on.
};

/** Runs fixed rules after reads and calls `notify` with what fired. */
export const alerts = (
  options: AlertsOptions
): OutboundPlugin<AlertsExtension> => {
  const evaluate = (records: readonly OutboundRecord[]): Alert[] =>
    records.flatMap((record) =>
      options.rules.flatMap((rule) => {
        const alert = rule.check(record);

        return alert === null ? [] : [alert];
      })
    );

  return {
    extend: () => ({ alerts: { evaluate } }),
    name: "alerts",
    wrap: async (operation, next) => {
      const output = await next(operation);
      const fired = evaluate(output.items);

      if (fired.length > 0) {
        try {
          // oxlint-disable-next-line promise/prefer-await-to-then -- fire-and-forget by design.
          Promise.resolve(options.notify(fired)).catch(ignore);
        } catch {
          ignore();
        }
      }

      return output;
    },
  };
};
