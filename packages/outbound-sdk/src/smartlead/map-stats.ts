// Smartlead analytics -> MetricRow. Pure functions, no I/O.
//
// Smartlead returns most counts as strings and reports no delivered count
// and no automatic-reply count. Rates are never read; only counts are.

import type { MetricRow } from "../internal/entities.ts";
import { count, field, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { emptyCounts, metricRow } from "../internal/metrics.ts";
import type { MetricCounts, RowScope } from "../internal/metrics.ts";
import { fromOne } from "../internal/sequence.ts";

export type { RowScope } from "../internal/metrics.ts";

/** The timezone every dated request asks for. */
export const TIMEZONE = "UTC";

const campaignCounts = (raw: JsonObject): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(raw.bounce_count),
  clicked: count(raw.unique_click_count),
  clickedTotal: count(raw.click_count),
  contacted: count(raw.unique_sent_count),
  opened: count(raw.unique_open_count),
  openedTotal: count(raw.open_count),
  replied: count(raw.reply_count),
  sent: count(raw.sent_count),
  unsubscribed: count(raw.unsubscribed_count),
});

/**
 * `GET /campaigns/{id}/analytics`: lifetime totals. `interested` is the
 * number of leads in a category with a positive sentiment.
 */
export const lifetimeRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(scope, {
    ...campaignCounts(raw),
    positive: count(field(raw.campaign_lead_stats, "interested")),
  });

// Smartlead's own formula: `total_reply_count - non_ooo_reply_count`. Both
// come from reply categorisation, so the difference is the out-of-office
// replies and nothing else.
const outOfOffice = (raw: JsonObject): number | null => {
  const total = count(raw.total_reply_count);
  const people = count(raw.non_ooo_reply_count);

  return total === null || people === null || total < people
    ? null
    : total - people;
};

/**
 * `GET /campaigns/{id}/analytics-by-date`: totals for a window. The window
 * separates out-of-office replies, so `replied` leaves them out when it can
 * and `repliedAuto` counts them.
 */
export const windowRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(
    scope,
    {
      ...campaignCounts(raw),
      replied: count(raw.non_ooo_reply_count) ?? count(raw.reply_count),
      repliedAuto: outOfOffice(raw),
    },
    { timezone: TIMEZONE }
  );

/** `GET /analytics/overall-stats-v2`: `data.overall_stats`. */
export const overallRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(
    scope,
    {
      ...emptyCounts(),
      bounced: count(raw.bounced),
      contacted: count(raw.unique_lead_count),
      opened: count(raw.unique_open_count),
      openedTotal: count(raw.opened),
      positive: count(raw.positive_replied),
      replied: count(raw.replied),
      sent: count(raw.sent),
    },
    { timezone: TIMEZONE }
  );

/**
 * `GET /analytics/day-wise-overall-stats`: one row per day. Its `bounced` is
 * documented as always 0, so it is not read. `positive` is that day's
 * `positive_replied` from `GET /analytics/day-wise-positive-reply-stats`.
 */
export const dayRow = (
  scope: RowScope,
  raw: JsonObject,
  positive?: Json | undefined
): MetricRow =>
  metricRow(
    scope,
    {
      ...emptyCounts(),
      openedTotal: count(raw.opened),
      positive: count(positive),
      replied: count(raw.replied),
      sent: count(raw.sent),
    },
    { date: text(raw.date), timezone: TIMEZONE }
  );

/**
 * One mailbox's row of `GET /analytics/mailbox/name-wise-health-metrics`, or
 * `undefined` when the response has none for it: every count is then `null`.
 * `opened` is not said to be unique, so it is the total.
 */
export const mailboxRow = (
  scope: RowScope,
  raw: JsonObject | undefined
): MetricRow =>
  metricRow(
    scope,
    {
      ...emptyCounts(),
      bounced: count(raw?.bounced),
      openedTotal: count(raw?.opened),
      replied: count(raw?.replied),
      sent: count(raw?.sent),
    },
    { timezone: TIMEZONE }
  );

const stepCounts = (stats: Json | undefined): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(field(stats, "bounce_count")),
  // The step report has one click count and one open count and does not call
  // either unique, so both are read as totals.
  clickedTotal: count(field(stats, "click_count")),
  openedTotal: count(field(stats, "open_count")),
  positive: count(field(stats, "positive_reply_count")),
  replied: count(field(stats, "reply_count")),
  sent: count(field(stats, "sent_count")),
  unsubscribed: count(field(stats, "unsubscribed_count")),
});

/**
 * One step of `GET /campaigns/{id}/sequence-analytics`: a row per variant,
 * or the step total when the step has no variants.
 */
export const stepRows = (scope: RowScope, step: JsonObject): MetricRow[] => {
  const stepIndex = fromOne(step.seq_number);
  const variants = objects(step.variants);

  if (variants.length === 0) {
    return [
      metricRow(scope, stepCounts(step.total_stats), {
        stepIndex,
        timezone: TIMEZONE,
      }),
    ];
  }

  return variants.map((variant) =>
    metricRow(scope, stepCounts(variant.stats), {
      stepIndex,
      timezone: TIMEZONE,
      variantKey: text(variant.variant_label),
    })
  );
};
