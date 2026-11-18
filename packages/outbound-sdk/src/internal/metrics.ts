// Metric definitions live here and only here, so every adapter and plugin
// computes a reply rate the same way. Vendor percentages are never trusted:
// rates are always recomputed from counts.

import type { MetricRow, MetricScope } from "./entities.ts";
import { OutboundError } from "./errors.ts";
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
  "meetingsBooked",
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
  meetingsBooked: null,
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

const TRACKED_KEYS = [
  "clicked",
  "clickedTotal",
  "opened",
  "openedTotal",
] as const satisfies readonly (keyof MetricCounts)[];

/**
 * `sumCounts` for a rollup that is read as one total. An open or click count
 * is `null` when any row that sent mail has it `null`: that row did not
 * measure it, so adding up the others would understate the rate without
 * saying so. Internal: the public `sumCounts` keeps every count it can.
 */
export const sumMeasured = (rows: readonly MetricCounts[]): MetricCounts => {
  const total = sumCounts(rows);
  const sending = rows.filter((row) => (row.sent ?? 0) > 0);

  for (const key of TRACKED_KEYS) {
    if (
      total[key] !== null &&
      sending.some((row) => row[key] === null || row[key] === undefined)
    ) {
      total[key] = null;
    }
  }

  return total;
};

export interface FillDaysOptions {
  /** The first day, `YYYY-MM-DD`. */
  readonly from: string;
  /** The last day, `YYYY-MM-DD`, included. */
  readonly to: string;
  /**
   * What a day with no row gets. `null` (the default): every count unknown,
   * since the vendor did not report the day. `zero`: 0 for each count the
   * scope's other rows report, for a vendor that leaves out days with no
   * activity; a count those rows never report stays `null`.
   */
  readonly fill?: "null" | "zero" | undefined;
}

const DAY_MS = 86_400_000;

const dayOf = (value: string, name: string): number => {
  const time = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Number.NaN;

  if (Number.isNaN(time)) {
    throw new OutboundError("Invalid", `${name} must be a day, YYYY-MM-DD`);
  }

  return time;
};

const filledRow = (
  rows: readonly MetricRow[],
  date: string,
  fill: "null" | "zero"
): MetricRow => {
  const counts = emptyCounts();

  if (fill === "zero") {
    for (const key of COUNT_KEYS) {
      if (rows.some((row) => row[key] !== null && row[key] !== undefined)) {
        counts[key] = 0;
      }
    }
  }

  // SAFETY: rows is a scope's rows, and a scope is only made from a row.
  const [first] = rows as [MetricRow, ...MetricRow[]];

  return { ...first, ...counts, contentHash: null, date, evidence: "derived" };
};

/**
 * Daily rows made dense: one row per scope for every day from `from` to
 * `to`, oldest first. A day the vendor returned no row for gets one with
 * `evidence: "derived"`, its scope's `timezone` and `tracking`, and counts
 * set by `fill`, so it is never mistaken for a day the vendor reported.
 * Rows the vendor returned are kept as they are. Only scopes with at least
 * one row are filled: a campaign with no row in the range is not known here.
 */
export const fillDays = (
  rows: readonly MetricRow[],
  options: FillDaysOptions
): MetricRow[] => {
  const from = dayOf(options.from, "from");
  const to = dayOf(options.to, "to");

  if (from > to) {
    throw new OutboundError("Invalid", "from must not be after to");
  }

  const scopes = new Map<string, MetricRow[]>();

  for (const row of rows) {
    if (row.date === null) {
      throw new OutboundError(
        "Invalid",
        'fillDays takes daily rows: read stats with by: "day"'
      );
    }

    scopes.set(row.scopeRef, [...(scopes.get(row.scopeRef) ?? []), row]);
  }

  const days = Array.from({ length: (to - from) / DAY_MS + 1 }, (_, index) =>
    new Date(from + index * DAY_MS).toISOString().slice(0, 10)
  );

  const dates = [...new Set([...days, ...rows.map((row) => row.date ?? "")])];

  return dates.toSorted().flatMap((date) =>
    [...scopes.values()].flatMap((own) => {
      const reported = own.filter((row) => row.date === date);

      return reported.length > 0 || !days.includes(date)
        ? reported
        : [filledRow(own, date, options.fill ?? "null")];
    })
  );
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
