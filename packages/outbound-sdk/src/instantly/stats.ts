import type { AdapterContext, StatsQuery } from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { text } from "../internal/json.ts";
import { applyTracking, ownTracking } from "../internal/tracking.ts";
import type { InstantlyClient } from "./client.ts";
import {
  campaignRow,
  dailyRow,
  overviewRow,
  stepRow,
  summedRow,
} from "./map-stats.ts";
import type { RowScope } from "./map-stats.ts";
import {
  campaignFlags,
  everyCampaignFlags,
  reportTracking,
  workspaceTracking,
} from "./stats-tracking.ts";

const range = (query: StatsQuery) => ({
  end_date: query.to,
  start_date: query.from,
});

const senderStats = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const days = await client.getRows(ctx, "/accounts/analytics/daily", {
    query: { ...range(query), emails: scope.scopeId },
  });

  const rows =
    query.by === "day"
      ? days.map((day) => dailyRow(scope, day))
      : [summedRow(scope, days)];

  // A mailbox sends for many campaigns, so it is judged like the workspace.
  return applyTracking(
    rows,
    await workspaceTracking(client, ctx, range(query))
  );
};

/** One campaign's rows, judged on that campaign's settings. */
const ownRows = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  campaignId: string,
  rows: MetricRow[]
): Promise<MetricRow[]> => {
  const flags = await campaignFlags(client, ctx, campaignId);

  return applyTracking(
    rows,
    flags === null ? null : [ownTracking(flags, rows)]
  );
};

/** A campaign's rows, or the workspace's when no campaign is named. */
const judged = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: StatsQuery,
  rows: MetricRow[]
): Promise<MetricRow[]> =>
  query.scopeId === undefined
    ? applyTracking(rows, await workspaceTracking(client, ctx, range(query)))
    : await ownRows(client, ctx, query.scopeId, rows);

/** Reads the analytics endpoint that matches the scope and grouping. */
export const readStats = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const { identity } = client;

  const scope: RowScope = {
    ...identity,
    scope: query.scope,
    scopeId: query.scopeId ?? identity.workspaceId,
  };

  if (query.scope === "sender") {
    return await senderStats(client, ctx, scope, query);
  }

  if (query.scope === "campaign" && query.scopeId === undefined) {
    if (query.by === "day") {
      throw new OutboundError(
        "Unsupported",
        "Instantly reports every campaign in one call as totals only; read one campaign for its days",
        { provider: identity.provider }
      );
    }

    // With no `id` the endpoint answers for every campaign, a row each.
    const campaigns = await client.getRows(ctx, "/campaigns/analytics", {
      query: range(query),
    });

    // Each campaign is judged on its own settings, from the listing.
    const flags = await everyCampaignFlags(client, ctx);

    return campaigns.flatMap((campaign) => {
      const scopeId = text(campaign.campaign_id);

      if (scopeId === null) {
        return [];
      }

      const row = campaignRow({ ...scope, scopeId }, campaign);

      return applyTracking(
        [row],
        flags === null
          ? null
          : [{ ...reportTracking(campaign, flags.get(scopeId)), sent: null }]
      );
    });
  }

  if (query.scope === "step") {
    if (query.by === "day") {
      throw new OutboundError(
        "Unsupported",
        "Instantly reports step analytics as totals only",
        {
          provider: identity.provider,
        }
      );
    }

    const steps = await client.getRows(ctx, "/campaigns/analytics/steps", {
      query: { ...range(query), campaign_id: query.scopeId },
    });

    return await judged(
      client,
      ctx,
      query,
      steps.map((step) => stepRow(scope, step))
    );
  }

  if (query.by === "day") {
    const days = await client.getRows(ctx, "/campaigns/analytics/daily", {
      query: { ...range(query), campaign_id: query.scopeId },
    });

    return await judged(
      client,
      ctx,
      query,
      days.map((day) => dailyRow(scope, day))
    );
  }

  const overview = await client.getObject(
    ctx,
    "/campaigns/analytics/overview",
    {
      query: { ...range(query), id: query.scopeId },
    }
  );

  return await judged(client, ctx, query, [overviewRow(scope, overview)]);
};
