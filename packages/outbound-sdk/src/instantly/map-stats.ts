// Instantly analytics -> MetricRow. Pure functions, no I/O.
//
// Instantly uses two naming schemes: `emails_sent_count` on the campaign and
// overview endpoints, and `sent` on the daily and step endpoints. Neither
// reports a delivered count. Rates are never read; only counts are.

import { SCHEMA_VERSION } from "../internal/entities.ts";
import type { MetricRow, MetricScope } from "../internal/entities.ts";
import { count, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { emptyCounts, sumCounts } from "../internal/metrics.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import type { Identity } from "../internal/record.ts";
import { makeRef } from "../internal/ref.ts";
import { variantKey } from "./map.ts";

export interface RowScope extends Identity {
  readonly scope: MetricScope;
  readonly scopeId: string;
}

const row = (
  scope: RowScope,
  counts: MetricCounts,
  extra: Partial<
    Pick<MetricRow, "date" | "evidence" | "stepIndex" | "variantKey">
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
  // The analytics responses do not state the timezone of a "day".
  timezone: null,
  variantKey: extra.variantKey ?? null,
  workspaceId: scope.workspaceId,
});

/** `GET /campaigns/analytics/overview`: totals, including interested leads. */
export const overviewRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  row(scope, {
    ...emptyCounts(),
    bounced: count(raw.bounced_count),
    clicked: count(raw.link_click_count_unique),
    contacted: count(raw.contacted_count),
    opened: count(raw.open_count_unique),
    openedTotal: count(raw.open_count),
    positive: count(raw.total_interested),
    replied: count(raw.reply_count_unique),
    repliedAuto: count(raw.reply_count_automatic_unique),
    sent: count(raw.emails_sent_count),
    unsubscribed: count(raw.unsubscribed_count),
  });

const dailyCounts = (raw: JsonObject): MetricCounts => ({
  ...emptyCounts(),
  bounced: count(raw.bounced),
  clicked: count(raw.unique_clicks),
  contacted: count(raw.contacted),
  opened: count(raw.unique_opened),
  openedTotal: count(raw.opened),
  replied: count(raw.unique_replies),
  repliedAuto: count(raw.unique_replies_automatic),
  sent: count(raw.sent),
});

/** `GET /campaigns/analytics/daily` and `GET /accounts/analytics/daily`. */
export const dailyRow = (scope: RowScope, raw: JsonObject): MetricRow =>
  row(scope, dailyCounts(raw), { date: text(raw.date) });

/**
 * A total built by adding daily rows. Unique counts are summed across days,
 * which over-counts a person seen on more than one day, so it is `derived`.
 */
export const summedRow = (
  scope: RowScope,
  days: readonly JsonObject[]
): MetricRow =>
  row(scope, sumCounts(days.map(dailyCounts)), { evidence: "derived" });

/** `GET /campaigns/analytics/steps`: step is 1-based, variant is 0-based. */
export const stepRow = (scope: RowScope, raw: JsonObject): MetricRow => {
  const step = count(raw.step);
  const variant = count(raw.variant);

  return row(scope, dailyCounts(raw), {
    stepIndex: step === null || step < 1 ? null : step - 1,
    variantKey: variant === null ? null : variantKey(variant),
  });
};
