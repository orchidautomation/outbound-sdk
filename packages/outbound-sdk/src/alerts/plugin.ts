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

/**
 * Remembers which alerts were already notified, by a key per alert. Supply
 * your own to remember across runs; the SDK stores nothing itself.
 */
export interface AlertDedupe {
  readonly has: (key: string) => boolean | Promise<boolean>;
  readonly add: (key: string) => void | Promise<void>;
}

/** Remembers notified alerts in this process's memory, for one run or a test. */
export const memoryAlertDedupe = (): AlertDedupe => {
  const keys = new Set<string>();

  return {
    add: (key) => {
      keys.add(key);
    },
    has: (key) => keys.has(key),
  };
};

export interface AlertsOptions {
  readonly rules: readonly AlertRule[];
  readonly notify: (alerts: readonly Alert[]) => void | Promise<void>;
  /**
   * Notify once per distinct alert, where an alert is its rule and its
   * subject: `sender-not-active|<sender ref>`. Without it, every read that
   * shows the condition notifies again.
   */
  readonly dedupe?: AlertDedupe | undefined;
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

/** The alerts not notified before, each marked as notified. */
const fresh = async (
  fired: readonly Alert[],
  seen: AlertDedupe
): Promise<Alert[]> => {
  const unseen: Alert[] = [];

  for (const alert of fired) {
    const key = `${alert.rule}|${alert.subject}`;

    // oxlint-disable-next-line no-await-in-loop -- one key at a time, so the same alert twice in one read is caught.
    if (!(await seen.has(key))) {
      // oxlint-disable-next-line no-await-in-loop -- marked before the next key is checked.
      await seen.add(key);
      unseen.push(alert);
    }
  }

  return unseen;
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

  const { dedupe } = options;

  // One at a time, so two reads that finish together cannot both find the
  // same alert unseen.
  let last: Promise<void> = Promise.resolve();

  const notifyFresh = (fired: readonly Alert[], seen: AlertDedupe): void => {
    last = (async () => {
      try {
        await last;
        const due = await fresh(fired, seen);

        if (due.length > 0) {
          await options.notify(due);
        }
      } catch {
        ignore();
      }
    })();
  };

  const notifyAll = (fired: readonly Alert[]): void => {
    try {
      // oxlint-disable-next-line promise/prefer-await-to-then -- fire-and-forget by design.
      Promise.resolve(options.notify(fired)).catch(ignore);
    } catch {
      ignore();
    }
  };

  return {
    extend: () => ({ alerts: { evaluate } }),
    name: "alerts",
    wrap: async (operation, next) => {
      const output = await next(operation);
      const fired = evaluate(output.items);

      if (fired.length > 0) {
        if (dedupe === undefined) {
          notifyAll(fired);
        } else {
          notifyFresh(fired, dedupe);
        }
      }

      return output;
    },
  };
};
