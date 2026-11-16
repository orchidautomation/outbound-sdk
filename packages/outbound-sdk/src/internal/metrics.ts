// Metric definitions live here and only here, so every adapter and plugin
// computes a reply rate the same way. Vendor percentages are never trusted:
// rates are always recomputed from counts.

import type { MetricRow, MetricScope } from "./entities.ts";
import type { Identity } from "./record.ts";
import { makeRef } from "./ref.ts";
import { SCHEMA_VERSION } from "./vocabulary.ts";

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

/**
 * How many times a campaign's leads its count of leads contacted may be
 * before the count reads as a fault. Leads removed after their sequence
 * started stay in `contacted`, so it can pass `leads` on correct data (seen
 * live: 430 started against 383 leads). A count that also takes in each step
 * a lead reaches is several times the leads (1,404 against 383 on a
 * four-step campaign). Two times sits between the two.
 */
export const CONTACTED_LEADS_LIMIT = 2;

/**
 * `true` when `contacted` is more than `CONTACTED_LEADS_LIMIT` times `leads`,
 * which means the count of leads contacted is not what it says. `false` when
 * either is unknown or the campaign has no leads to compare with.
 */
export const contactedBeyondLeads = (
  contacted: number | null,
  leads: number | null | undefined
): boolean =>
  contacted !== null &&
  leads !== null &&
  leads !== undefined &&
  leads > 0 &&
  contacted > leads * CONTACTED_LEADS_LIMIT;

const COUNT_KEYS = [
  "bounced",
  "clicked",
  "clickedTotal",
  "completed",
  "connectionsAccepted",
  "connectionsSent",
  "contacted",
  "delivered",
  "inmailsSent",
  "leads",
  "opened",
  "openedTotal",
  "opportunities",
  "opportunityValue",
  "positive",
  "replied",
  "repliedAuto",
  "repliedAutoTotal",
  "repliedTotal",
  "sent",
  "unsubscribed",
] as const satisfies readonly (keyof MetricRow)[];

export type MetricCounts = Pick<MetricRow, (typeof COUNT_KEYS)[number]>;

/** A row of counts with every value unknown. */
export const emptyCounts = (): MetricCounts => ({
  bounced: null,
  clicked: null,
  clickedTotal: null,
  completed: null,
  connectionsAccepted: null,
  connectionsSent: null,
  contacted: null,
  delivered: null,
  inmailsSent: null,
  leads: null,
  opened: null,
  openedTotal: null,
  opportunities: null,
  opportunityValue: null,
  positive: null,
  replied: null,
  repliedAuto: null,
  repliedAutoTotal: null,
  repliedTotal: null,
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

      if (value !== null && value !== undefined) {
        total[key] = (total[key] ?? 0) + value;
      }
    }
  }

  return total;
};

/** What a row of counts is for: a workspace, a campaign, a step or a sender. */
export interface RowScope extends Identity {
  readonly scope: MetricScope;
  readonly scopeId: string;
}

/**
 * One `MetricRow` from the counts an adapter read. A total with nothing else
 * to say needs only the scope and the counts; a daily, step or derived row
 * says so in `extra`.
 */
export const metricRow = (
  scope: RowScope,
  counts: MetricCounts,
  extra: Partial<
    Pick<
      MetricRow,
      "date" | "evidence" | "stepIndex" | "timezone" | "variantKey"
    >
  > = {}
): MetricRow => ({
  ...counts,
  contentHash: null,
  date: extra.date ?? null,
  evidence: extra.evidence ?? "exact",
  provider: scope.provider,
  schemaVersion: SCHEMA_VERSION,
  scope: scope.scope,
  scopeRef: makeRef(scope.provider, scope.workspaceId, scope.scopeId),
  stepIndex: extra.stepIndex ?? null,
  timezone: extra.timezone ?? null,
  variantKey: extra.variantKey ?? null,
  workspaceId: scope.workspaceId,
});
