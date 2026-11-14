// Metric definitions live here and only here, so every adapter and plugin
// computes a reply rate the same way. Vendor percentages are never trusted:
// rates are always recomputed from counts.

import type { MetricRow } from "./entities.ts";

export interface MetricDefinition {
  readonly name: string;
  readonly description: string;
}

/** The metric dictionary. Each number an agent sees has one written meaning. */
export const METRIC_DEFINITIONS = {
  acceptanceRate: {
    description:
      "LinkedIn connection requests accepted, divided by connection requests sent.",
    name: "Connection acceptance rate",
  },
  bounceRate: {
    description: "Messages that bounced, divided by messages sent.",
    name: "Bounce rate",
  },
  openRate: {
    description:
      "Unique opens divided by messages delivered (or sent when delivered is unknown). Null when open tracking is off. Mail privacy features inflate opens.",
    name: "Open rate",
  },
  positiveReplyRate: {
    description:
      "Replies the vendor marked positive, divided by unique leads contacted (or messages sent when contacted is unknown).",
    name: "Positive reply rate",
  },
  replyRate: {
    description:
      "Replies from people, excluding auto-replies where the vendor separates them, divided by unique leads contacted (or messages sent when contacted is unknown).",
    name: "Reply rate",
  },
  unsubscribeRate: {
    description:
      "Unsubscribes divided by unique leads contacted (or messages sent).",
    name: "Unsubscribe rate",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricName = keyof typeof METRIC_DEFINITIONS;

export interface Rate {
  /** Between 0 and 1, or `null` when either count is missing or the base is 0. */
  readonly value: number | null;
  /** Which count the rate was divided by. */
  readonly basis: "connectionsSent" | "contacted" | "delivered" | "sent" | null;
}

const NO_RATE: Rate = { basis: null, value: null };

const divide = (
  numerator: number | null,
  denominator: number | null,
  basis: Rate["basis"]
): Rate | null => {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }

  return { basis, value: numerator / denominator };
};

const perLead = (row: MetricRow, numerator: number | null): Rate =>
  divide(numerator, row.contacted, "contacted") ??
  divide(numerator, row.sent, "sent") ??
  NO_RATE;

/** Computes every rate for one row of counts. */
export const computeRates = (row: MetricRow): Record<MetricName, Rate> => ({
  acceptanceRate:
    divide(row.connectionsAccepted, row.connectionsSent, "connectionsSent") ??
    NO_RATE,
  bounceRate: divide(row.bounced, row.sent, "sent") ?? NO_RATE,
  openRate:
    divide(row.opened, row.delivered, "delivered") ??
    divide(row.opened, row.sent, "sent") ??
    NO_RATE,
  positiveReplyRate: perLead(row, row.positive),
  replyRate: perLead(row, row.replied),
  unsubscribeRate: perLead(row, row.unsubscribed),
});

const COUNT_KEYS = [
  "bounced",
  "clicked",
  "clickedTotal",
  "connectionsAccepted",
  "connectionsSent",
  "contacted",
  "delivered",
  "inmailsSent",
  "opened",
  "openedTotal",
  "positive",
  "replied",
  "repliedAuto",
  "sent",
  "unsubscribed",
] as const satisfies readonly (keyof MetricRow)[];

export type MetricCounts = Pick<MetricRow, (typeof COUNT_KEYS)[number]>;

/** A row of counts with every value unknown. */
export const emptyCounts = (): MetricCounts => ({
  bounced: null,
  clicked: null,
  clickedTotal: null,
  connectionsAccepted: null,
  connectionsSent: null,
  contacted: null,
  delivered: null,
  inmailsSent: null,
  opened: null,
  openedTotal: null,
  positive: null,
  replied: null,
  repliedAuto: null,
  sent: null,
  unsubscribed: null,
});

/**
 * Adds rows together. A count stays `null` only when no row reports it, so a
 * missing value is never turned into 0. Unique counts (opened, contacted)
 * are summed, which over-counts people who appear in more than one row.
 */
export const sumCounts = (rows: readonly MetricCounts[]): MetricCounts => {
  const total = emptyCounts();

  for (const row of rows) {
    for (const key of COUNT_KEYS) {
      const value = row[key];

      if (value !== null) {
        total[key] = (total[key] ?? 0) + value;
      }
    }
  }

  return total;
};
