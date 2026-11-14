// HeyReach analytics -> MetricRow. Pure functions, no I/O.
//
// GetOverallStats returns `overallStats` (one object of totals) and
// `byDayStats` (an object keyed by UTC-midnight ISO strings). The rates it
// also returns are never read; only counts are. HeyReach reports no opens,
// bounces, deliveries or unsubscribes, so those stay null.

import { SCHEMA_VERSION } from "../internal/entities.ts";
import type { MetricRow, MetricScope } from "../internal/entities.ts";
import { count, field, isJsonObject, timestamp } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { emptyCounts } from "../internal/metrics.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import type { Identity } from "../internal/record.ts";
import { makeRef } from "../internal/ref.ts";

export interface RowScope extends Identity {
  readonly scope: MetricScope;
  readonly scopeId: string;
}

// Replies to messages and replies to InMails are both replies from people.
const replies = (stats: Json | undefined): number | null => {
  const messages = count(field(stats, "totalMessageReplies"));
  const inmails = count(field(stats, "totalInmailReplies"));

  return messages === null && inmails === null
    ? null
    : (messages ?? 0) + (inmails ?? 0);
};

// `totalMessageStarted` and `totalInmailStarted` are not defined in the docs,
// so they are not read as `contacted`. `uniqueLeadsContacted` and
// `autoTaggedInterested` are returned by the live API (seen 2026-11-14) but
// are not in the API reference; when they are absent the counts stay null.
const counts = (stats: Json | undefined): MetricCounts => ({
  ...emptyCounts(),
  connectionsAccepted: count(field(stats, "connectionsAccepted")),
  connectionsSent: count(field(stats, "connectionsSent")),
  contacted: count(field(stats, "uniqueLeadsContacted")),
  inmailsSent: count(field(stats, "inmailMessagesSent")),
  positive: count(field(stats, "autoTaggedInterested")),
  replied: replies(stats),
  sent: count(field(stats, "messagesSent")),
});

const row = (
  scope: RowScope,
  stats: Json | undefined,
  date: string | null
): MetricRow => ({
  ...counts(stats),
  contentHash: null,
  date,
  evidence: "exact",
  provider: scope.provider,
  schemaVersion: SCHEMA_VERSION,
  scope: scope.scope,
  scopeRef: makeRef(scope.provider, scope.workspaceId, scope.scopeId),
  stepIndex: null,
  // Days are keyed by UTC midnight.
  timezone: date === null ? null : "UTC",
  variantKey: null,
  workspaceId: scope.workspaceId,
});

export const totalRow = (scope: RowScope, body: Json): MetricRow =>
  row(scope, field(body, "overallStats"), null);

/** One row per key of `byDayStats`, oldest first. */
export const dailyRows = (scope: RowScope, body: Json): MetricRow[] => {
  const days = field(body, "byDayStats");

  return Object.entries(isJsonObject(days) ? days : {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([day, stats]) => {
      const date = timestamp(day)?.slice(0, 10);

      return date === undefined ? [] : [row(scope, stats, date)];
    });
};
