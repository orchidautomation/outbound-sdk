// EmailBison statistics -> MetricRow. Pure functions, no I/O. Counts arrive
// as strings in the summaries and as numbers elsewhere; `count` reads both.
// Vendor percentages are never read: rates are computed from counts.

import type { MetricRow } from "../internal/entities.ts";
import { count, field, isJsonArray, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { emptyCounts, metricRow, sumCounts } from "../internal/metrics.ts";
import type { MetricCounts, RowScope } from "../internal/metrics.ts";
import type { StepPlace } from "./map-sequence.ts";

/** The totals of `GET /api/workspaces/v1.1/stats` and `POST /api/campaigns/{id}/stats`. */
export const summaryCounts = (summary: Json | undefined): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(field(summary, "bounced")),
  contacted: count(field(summary, "total_leads_contacted")),
  opened: count(field(summary, "unique_opens_per_contact")),
  openedTotal: count(field(summary, "opened")),
  positive: count(field(summary, "interested")),
  replied: count(field(summary, "unique_replies_per_contact")),
  sent: count(field(summary, "emails_sent")),
  unsubscribed: count(field(summary, "unsubscribed")),
});

/** A sender's lifetime counts, from its own record. */
export const senderCounts = (sender: JsonObject): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(sender.bounced_count),
  contacted: count(sender.total_leads_contacted_count),
  opened: count(sender.unique_opened_count),
  openedTotal: count(sender.total_opened_count),
  positive: count(sender.interested_leads_count),
  replied: count(sender.unique_replied_count),
  sent: count(sender.emails_sent_count),
  unsubscribed: count(sender.unsubscribed_count),
});

// The series labels the line-area reads document.
const SERIES = new Map<string, keyof MetricCounts>([
  ["bounced", "bounced"],
  ["interested", "positive"],
  ["replied", "replied"],
  ["sent", "sent"],
  ["total opens", "openedTotal"],
  ["unique opens", "opened"],
  ["unsubscribed", "unsubscribed"],
]);

/**
 * One row per day of a line-area answer: `[{ label, dates: [[day, n]] }]`.
 * A series it leaves out is `null` on every day.
 */
export const dailyRows = (scope: RowScope, body: Json): MetricRow[] => {
  const days = new Map<string, MetricCounts>();

  for (const series of objects(field(body, "data"))) {
    const key = SERIES.get((text(series.label) ?? "").toLowerCase());

    if (key === undefined) {
      continue;
    }

    for (const point of Array.isArray(series.dates) ? series.dates : []) {
      const day = isJsonArray(point) ? text(point[0]) : null;

      if (day === null || !/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
        continue;
      }

      const counts = days.get(day) ?? emptyCounts();
      counts[key] = count(isJsonArray(point) ? point[1] : undefined);
      days.set(day, counts);
    }
  }

  return [...days.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([date, counts]) => metricRow(scope, counts, { date }));
};

/** The daily rows of a range added up, as one derived total. */
export const summedRow = (scope: RowScope, rows: readonly MetricRow[]) =>
  metricRow(scope, sumCounts(rows), { evidence: "derived" });

/**
 * A row per step of `sequence_step_stats`. `places` says where each step id
 * sits; a step it does not know is left out, because its place is unknown.
 */
export const stepRows = (
  scope: RowScope,
  summary: Json | undefined,
  places: ReadonlyMap<string, StepPlace>
): MetricRow[] =>
  objects(field(summary, "sequence_step_stats")).flatMap((step) => {
    const place = places.get(text(step.sequence_step_id) ?? "");

    if (place === undefined) {
      return [];
    }

    return [
      metricRow(
        scope,
        {
          ...emptyCounts(),
          bounced: count(step.bounced),
          contacted: count(step.leads_contacted),
          opened: count(step.unique_opens),
          positive: count(step.interested),
          replied: count(step.unique_replies),
          sent: count(step.sent),
          unsubscribed: count(step.unsubscribed),
        },
        { stepIndex: place.stepIndex, variantKey: place.variantKey }
      ),
    ];
  });
