// Instantly analytics -> MetricRow. Pure functions, no I/O.
//
// Instantly uses two naming schemes: `emails_sent_count` on the campaign and
// overview endpoints, and `sent` on the daily and step endpoints. Neither
// reports a delivered count. Rates are never read; only counts are.

import type { MetricRow } from "../internal/entities.ts";
import { count, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { emptyCounts, sumCounts, metricRow } from "../internal/metrics.ts";
import type { MetricCounts, RowScope } from "../internal/metrics.ts";
import { variantKey } from "../internal/sequence.ts";

export type { RowScope } from "../internal/metrics.ts";

/** `GET /campaigns/analytics/overview`: totals, including interested leads. */
export const overviewRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(scope, {
    ...emptyCounts(),
    bounced: count(raw.bounced_count),
    clicked: count(raw.link_click_count_unique),
    clickedTotal: count(raw.link_click_count),
    contacted: count(raw.contacted_count),
    opened: count(raw.open_count_unique),
    openedTotal: count(raw.open_count),
    positive: count(raw.total_interested),
    replied: count(raw.reply_count_unique),
    repliedAuto: count(raw.reply_count_automatic_unique),
    sent: count(raw.emails_sent_count),
    unsubscribed: count(raw.unsubscribed_count),
  });

/**
 * One campaign's row of `GET /campaigns/analytics`. Here `open_count` is the
 * leads who opened, not every open, so no total of opens is read, and the
 * report has no count of interested leads.
 */
export const campaignRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(scope, {
    ...emptyCounts(),
    bounced: count(raw.bounced_count),
    clicked: count(raw.link_click_count_unique),
    clickedTotal: count(raw.link_click_count),
    contacted: count(raw.contacted_count),
    opened: count(raw.open_count_unique),
    replied: count(raw.reply_count_unique),
    repliedAuto: count(raw.reply_count_automatic_unique),
    sent: count(raw.emails_sent_count),
    unsubscribed: count(raw.unsubscribed_count),
  });

const dailyCounts = (raw: JsonObject): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(raw.bounced),
  clicked: count(raw.unique_clicks),
  clickedTotal: count(raw.clicks),
  contacted: count(raw.contacted),
  opened: count(raw.unique_opened),
  openedTotal: count(raw.opened),
  replied: count(raw.unique_replies),
  repliedAuto: count(raw.unique_replies_automatic),
  sent: count(raw.sent),
});

/** `GET /campaigns/analytics/daily` and `GET /accounts/analytics/daily`. */
export const dailyRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  metricRow(scope, dailyCounts(raw), { date: text(raw.date) });

/**
 * A total built by adding daily rows. Unique counts are summed across days,
 * which over-counts a person seen on more than one day, so it is `derived`.
 */
export const summedRow = (
  scope: RowScope,
  days: readonly JsonObject[]
): MetricRow =>
  metricRow(scope, sumCounts(days.map(dailyCounts)), { evidence: "derived" });

/**
 * `GET /campaigns/analytics/steps`. Step and variant are both counted from 0
 * (seen live: a seven-step campaign reports steps "0" to "6"). A row whose
 * step is null or `\N` holds counts Instantly could not tie to a step.
 */
export const stepRow = (scope: RowScope, raw: JsonObject): MetricRow => {
  const step = count(raw.step);
  const variant = count(raw.variant);

  return metricRow(scope, dailyCounts(raw), {
    stepIndex: step !== null && Number.isInteger(step) ? step : null,
    variantKey: variant === null ? null : variantKey(variant),
  });
};
