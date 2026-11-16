// Instantly analytics -> MetricRow. Pure functions, no I/O.
//
// Instantly uses two naming schemes: `emails_sent_count` on the campaign and
// overview endpoints, and `sent` on the daily and step endpoints. Neither
// reports a delivered count. Rates are never read; only counts are.
//
// `contacted` is unique leads whose sequence started, the UI's "Sequence
// started". On the totals that is `new_leads_contacted_count`, not
// `contacted_count`: seen live, `contacted_count` counted lead-step contacts
// (1,404 against 430 on a four-step campaign), though the reference describes
// it as leads started. By day it is `new_leads_contacted`: `contacted` there is
// everyone emailed that day, so it repeats a lead on each step it reaches.
//
// Leads, completed leads and opportunities are on the totals only. The
// overview has no `leads_count`, so `leads` is read from the per-campaign
// report alone.

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
    completed: count(raw.completed_count),
    contacted: count(raw.new_leads_contacted_count),
    opened: count(raw.open_count_unique),
    openedTotal: count(raw.open_count),
    opportunities: count(raw.total_opportunities),
    opportunityValue: count(raw.total_opportunity_value),
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
    completed: count(raw.completed_count),
    contacted: count(raw.new_leads_contacted_count),
    leads: count(raw.leads_count),
    opened: count(raw.open_count_unique),
    opportunities: count(raw.total_opportunities),
    opportunityValue: count(raw.total_opportunity_value),
    replied: count(raw.reply_count_unique),
    repliedAuto: count(raw.reply_count_automatic_unique),
    sent: count(raw.emails_sent_count),
    unsubscribed: count(raw.unsubscribed_count),
  });

/** Counts shared by the daily and step reports; `contacted` differs by report. */
const reportCounts = (
  raw: JsonObject,
  contacted: number | null
): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(raw.bounced),
  clicked: count(raw.unique_clicks),
  clickedTotal: count(raw.clicks),
  contacted,
  opened: count(raw.unique_opened),
  openedTotal: count(raw.opened),
  replied: count(raw.unique_replies),
  repliedAuto: count(raw.unique_replies_automatic),
  sent: count(raw.sent),
});

/** A day's new leads, so days add up to the leads started over the range. */
const dailyCounts = (raw: JsonObject): MetricCounts =>
  reportCounts(raw, count(raw.new_leads_contacted));

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
 *
 * The reference lists no contacted count for a step. Where a row has
 * `contacted`, it is the leads that step reached, so it is read as it is:
 * a step's leads, not leads whose sequence started.
 */
export const stepRow = (scope: RowScope, raw: JsonObject): MetricRow => {
  const step = count(raw.step);
  const variant = count(raw.variant);

  return metricRow(scope, reportCounts(raw, count(raw.contacted)), {
    stepIndex: step !== null && Number.isInteger(step) ? step : null,
    variantKey: variant === null ? null : variantKey(variant),
  });
};
