// The EmailBison stats reads. Every dated read needs both dates; a missing
// end is today (UTC) and a missing start 2000-01-01 for a total, or 30 days
// before the end for daily rows.
//
// - workspace: GET /api/workspaces/v1.1/stats, by day .../line-area-chart-stats
// - campaign: POST /api/campaigns/{id}/stats, by day GET .../line-area-chart-stats
// - sender: its record (lifetime), or GET /api/campaign-events/stats by day
// - step: sequence_step_stats of the campaign's stats, placed by its steps
//
// A campaign's rows and its steps' are judged on the campaign's open tracking
// (`open_tracking` on GET /api/campaigns/{id}, one more request). Clicks are
// not a campaign setting, so they are left as read. Workspace and sender rows
// are not judged: no read gives every campaign's counts for a range without a
// request per campaign.

import type { AdapterContext, StatsQuery } from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { flag } from "../internal/json.ts";
import { metricRow } from "../internal/metrics.ts";
import type { RowScope } from "../internal/metrics.ts";
import {
  applyTracking,
  ownTracking,
  unlessFailed,
} from "../internal/tracking.ts";
import type { EmailBisonClient } from "./client.ts";
import { stepPlaces } from "./map-sequence.ts";
import {
  dailyRows,
  senderCounts,
  stepRows,
  summaryCounts,
  summedRow,
} from "./map-stats.ts";

const DAY_MS = 86_400_000;
const EARLIEST = "2000-01-01";

const day = (time: number): string => new Date(time).toISOString().slice(0, 10);

interface Range {
  readonly start_date: string;
  readonly end_date: string;
}

const rangeOf = (query: StatsQuery, daily: boolean, now: number): Range => {
  const end = query.to ?? day(now);

  const start =
    query.from ??
    (daily ? day(Date.parse(`${end}T00:00:00Z`) - 30 * DAY_MS) : EARLIEST);

  return { end_date: end, start_date: start };
};

const id = (scope: RowScope): string => encodeURIComponent(scope.scopeId);

const campaignSummary = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  range: Range
) => {
  const path = `/api/campaigns/${id(scope)}/stats`;

  return client.one(await client.post(ctx, path, { ...range }), path);
};

const senderDays = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  range: Range
): Promise<MetricRow[]> =>
  dailyRows(
    scope,
    await client.get(ctx, "/api/campaign-events/stats", {
      query: { ...range, "sender_email_ids[]": scope.scopeId },
    })
  );

const dailyPath = (scope: RowScope): string =>
  scope.scope === "campaign"
    ? `/api/campaigns/${id(scope)}/line-area-chart-stats`
    : "/api/workspaces/v1.1/line-area-chart-stats";

const readDaily = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  range: Range
): Promise<MetricRow[]> =>
  scope.scope === "sender"
    ? await senderDays(client, ctx, scope, range)
    : dailyRows(
        scope,
        await client.get(ctx, dailyPath(scope), { query: { ...range } })
      );

const readSender = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery,
  now: number
): Promise<MetricRow[]> => {
  if (query.from === undefined && query.to === undefined) {
    const path = `/api/sender-emails/${id(scope)}`;

    return [
      metricRow(
        scope,
        senderCounts(client.one(await client.get(ctx, path), path))
      ),
    ];
  }

  // The sender reads count a lifetime; a range is the daily events added up.
  return [
    summedRow(
      scope,
      await senderDays(client, ctx, scope, rangeOf(query, false, now))
    ),
  ];
};

const readSteps = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  range: Range
): Promise<MetricRow[]> => {
  const summary = await campaignSummary(client, ctx, scope, range);

  const steps = await client.get(
    ctx,
    `/api/campaigns/v1.1/${id(scope)}/sequence-steps`
  );

  return stepRows(scope, summary, stepPlaces(steps));
};

/** A campaign's rows, judged on its open tracking. */
const judged = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  scope: RowScope,
  rows: MetricRow[]
): Promise<MetricRow[]> => {
  const path = `/api/campaigns/${id(scope)}`;

  const flags = await unlessFailed(async () => ({
    clicks: null,
    opens: flag(client.one(await client.get(ctx, path), path).open_tracking),
  }));

  return applyTracking(
    rows,
    flags === null ? null : [ownTracking(flags, rows)]
  );
};

export const readStats = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  query: StatsQuery,
  now = Date.now()
): Promise<MetricRow[]> => {
  const { provider } = client.identity;

  if (query.scope === "campaign" && query.scopeId === undefined) {
    throw new OutboundError(
      "Unsupported",
      "EmailBison has no read with a row per campaign",
      { provider }
    );
  }

  const scope: RowScope = {
    ...client.identity,
    scope: query.scope,
    scopeId: query.scopeId ?? client.identity.workspaceId,
  };

  if (query.by === "day") {
    if (query.scope === "step") {
      throw new OutboundError(
        "Unsupported",
        "EmailBison reports a step's counts as totals only",
        { provider }
      );
    }

    const days = await readDaily(client, ctx, scope, rangeOf(query, true, now));

    return query.scope === "campaign"
      ? await judged(client, ctx, scope, days)
      : days;
  }

  const range = rangeOf(query, false, now);

  if (query.scope === "sender") {
    return await readSender(client, ctx, scope, query, now);
  }

  if (query.scope === "step") {
    return await judged(
      client,
      ctx,
      scope,
      await readSteps(client, ctx, scope, range)
    );
  }

  if (query.scope === "campaign") {
    return await judged(client, ctx, scope, [
      metricRow(
        scope,
        summaryCounts(await campaignSummary(client, ctx, scope, range))
      ),
    ]);
  }

  const path = "/api/workspaces/v1.1/stats";

  return [
    metricRow(
      scope,
      summaryCounts(
        client.one(await client.get(ctx, path, { query: { ...range } }), path)
      )
    ),
  ];
};
