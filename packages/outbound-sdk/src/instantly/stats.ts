import type { AdapterContext, StatsQuery } from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { text } from "../internal/json.ts";
import type { InstantlyClient } from "./client.ts";
import {
  campaignRow,
  dailyRow,
  overviewRow,
  stepRow,
  summedRow,
} from "./map-stats.ts";
import type { RowScope } from "./map-stats.ts";

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

  return query.by === "day"
    ? days.map((day) => dailyRow(scope, day))
    : [summedRow(scope, days)];
};

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

    return campaigns.flatMap((campaign) => {
      const scopeId = text(campaign.campaign_id);

      return scopeId === null
        ? []
        : [campaignRow({ ...scope, scopeId }, campaign)];
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

    return steps.map((step) => stepRow(scope, step));
  }

  if (query.by === "day") {
    const days = await client.getRows(ctx, "/campaigns/analytics/daily", {
      query: { ...range(query), campaign_id: query.scopeId },
    });

    return days.map((day) => dailyRow(scope, day));
  }

  const overview = await client.getObject(
    ctx,
    "/campaigns/analytics/overview",
    {
      query: { ...range(query), id: query.scopeId },
    }
  );

  return [overviewRow(scope, overview)];
};
