// HeyReach analytics -> MetricRow. Pure functions, no I/O.
//
// GetOverallStats returns `overallStats` (one object of totals) and
// `byDayStats` (an object keyed by UTC-midnight ISO strings). The rates it
// also returns are never read; only counts are. HeyReach reports no opens,
// bounces, deliveries or unsubscribes, so those stay null.

import type { MetricRow } from "../internal/entities.ts";
import {
  count,
  field,
  isJsonObject,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { emptyCounts, metricRow } from "../internal/metrics.ts";
import type { MetricCounts, RowScope } from "../internal/metrics.ts";
import type { Identity } from "../internal/record.ts";

export type { RowScope } from "../internal/metrics.ts";

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

// HeyReach counts `uniqueLeadsContacted` over the whole range only: every
// day of `byDayStats` reports 0 while the range's total does not, so a
// day's `contacted` is unknown, not 0.
const row = (
  scope: RowScope,
  stats: Json | undefined,
  date: string | null
): MetricRow =>
  // Days are keyed by UTC midnight.
  metricRow(
    scope,
    date === null ? counts(stats) : { ...counts(stats), contacted: null },
    { date, timezone: date === null ? null : "UTC" }
  );

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

// One row of GetOverallStatsByCampaign: the same counts with the campaign
// they belong to. A deleted campaign's row is kept; it still names its id.
const campaignRow = (
  identity: Identity,
  stats: JsonObject,
  date: string | null
): MetricRow[] => {
  const scopeId = text(stats.campaignId);

  return scopeId === null
    ? []
    : [row({ ...identity, scope: "campaign", scopeId }, stats, date)];
};

/**
 * `POST /stats/GetOverallStatsByCampaign`: `overallStats` is an array with a
 * row per campaign, and each day of `byDayStats` is such an array.
 */
export const campaignRows = (
  identity: Identity,
  body: Json,
  by: "day" | "total"
): MetricRow[] => {
  if (by === "total") {
    return objects(field(body, "overallStats")).flatMap((stats) =>
      campaignRow(identity, stats, null)
    );
  }

  const days = field(body, "byDayStats");

  return Object.entries(isJsonObject(days) ? days : {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([day, perCampaign]) => {
      const date = timestamp(day)?.slice(0, 10);

      return date === undefined
        ? []
        : objects(perCampaign).flatMap((stats) =>
            campaignRow(identity, stats, date)
          );
    });
};
