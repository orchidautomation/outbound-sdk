// outbound-sdk/alerts: fixed rules, checked after reads. A rule is plain
// arithmetic on what was just read; no model is involved. When a rule fires,
// your `notify` function is called. It is fire-and-forget: a notifier that
// fails cannot fail the read.

import type { Campaign, MetricRow, Sender } from "../internal/entities.ts";
import { computeRates } from "../internal/metrics.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { percentOf } from "../internal/plural.ts";

export interface Alert {
  /** The rule's name. */
  readonly rule: string;
  /** The ref of the campaign, sender or workspace it is about. */
  readonly subject: string;
  /**
   * The subject as a person knows it: the sender's address, or the campaign's
   * name when this instance has read that campaign. `null` when neither is known.
   */
  readonly subjectName?: string | null | undefined;
  readonly message: string;
  /** What was measured. */
  readonly value: number | string | null;
  /** What it was compared with. */
  readonly threshold: number | string | null;
  /**
   * The day of the data point, `YYYY-MM-DD`, for an alert about a day's
   * counts. With `dedupe`, the same rule and subject on another day is a new
   * alert. `null` or absent for a record that is not one day's.
   */
  readonly day?: string | null | undefined;
}

export interface AlertRule {
  readonly name: string;
  /** Returns an alert when the record breaks the rule, otherwise `null`. */
  readonly check: (record: OutboundRecord) => Alert | null;
  /**
   * The rule is about a state, such as a sender's status: with `dedupe`, a
   * new `value` for the same subject is a new alert (paused, then error).
   */
  readonly state?: boolean | undefined;
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
   * Notify once per distinct alert: its rule, its subject, the day of its
   * data point when it has one, and its value for a state rule
   * (`no-sends|<campaign ref>|2026-11-10`, `sender-not-active|<sender ref>|paused`).
   * Without it, every read that shows the condition notifies again.
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

const isCampaign = (record: OutboundRecord): record is Campaign =>
  "channel" in record && "tags" in record && "status" in record;


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
          message: `Bounce rate is ${percentOf(value)}, above ${percentOf(threshold)}`,
          day: record.date,
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
          message: `Reply rate is ${percentOf(value)}, below ${percentOf(threshold)}`,
          day: record.date,
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
          subjectName: record.address ?? record.name,
          threshold: "active",
          value: record.status,
        }
      : null,
  name: "sender-not-active",
  state: true,
});

/** Fires for a row that reported sends on a day with none: a sender gone quiet. */
export const noSends = (): AlertRule => ({
  check: (record) =>
    isMetricRow(record) && record.date !== null && record.sent === 0
      ? {
          day: record.date,
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

interface Fired {
  readonly alert: Alert;
  /** What makes it a repeat: `rule|subject`, then the day and a state's value when there are. */
  readonly key: string;
}

const keyOf = (alert: Alert, rule: AlertRule): string =>
  [
    alert.rule,
    alert.subject,
    ...(alert.day ? [alert.day] : []),
    ...(rule.state === true ? [String(alert.value)] : []),
  ].join("|");

/** The alerts not notified before, each marked as notified. */
const fresh = async (
  fired: readonly Fired[],
  seen: AlertDedupe
): Promise<Alert[]> => {
  const unseen: Alert[] = [];

  for (const { alert, key } of fired) {
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
  // The names of the campaigns read so far, so an alert about a campaign's
  // stats can name it without another read.
  const names = new Map<string, string>();

  const fire = (records: readonly OutboundRecord[]): Fired[] => {
    for (const record of records) {
      if (isCampaign(record)) {
        names.set(record.ref, record.name);
      }
    }

    return records.flatMap((record) =>
      options.rules.flatMap((rule) => {
        const alert = rule.check(record);

        return alert === null
          ? []
          : [
              {
                alert: {
                  ...alert,
                  subjectName:
                    alert.subjectName ?? names.get(alert.subject) ?? null,
                },
                key: keyOf(alert, rule),
              },
            ];
      })
    );
  };

  const evaluate = (records: readonly OutboundRecord[]): Alert[] =>
    fire(records).map((each) => each.alert);

  const { dedupe } = options;

  // One at a time, so two reads that finish together cannot both find the
  // same alert unseen.
  let last: Promise<void> = Promise.resolve();

  const notifyFresh = (fired: readonly Fired[], seen: AlertDedupe): void => {
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
      const fired = fire(output.items);

      if (fired.length > 0) {
        if (dedupe === undefined) {
          notifyAll(fired.map((each) => each.alert));
        } else {
          notifyFresh(fired, dedupe);
        }
      }

      return output;
    },
  };
};
