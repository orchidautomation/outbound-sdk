// Which Smartlead analytics endpoint answers which stats question.
//
// Every dated endpoint needs both a start and an end, so a missing bound is
// filled in here. The two endpoint families also name the timezone parameter
// differently: `time_zone` under /campaigns, `timezone` under /analytics.

import type { AdapterContext, StatsQuery } from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  emailAddress,
  field,
  isJsonObject,
  objects,
  text,
} from "../internal/json.ts";
import type { SmartleadClient } from "./client.ts";
import {
  dayRow,
  lifetimeRow,
  mailboxRow,
  overallRow,
  stepRows,
  TIMEZONE,
  windowRow,
} from "./map-stats.ts";
import type { RowScope } from "./map-stats.ts";
import { unwrap } from "./map.ts";
import { objectOf } from "./shared.ts";

const DAY_MS = 86_400_000;

/** Before Smartlead existed, so a total from here is a lifetime total. */
const LIFETIME_START = "2000-01-01";

/** `analytics-by-date` refuses a range of more than 30 days. */
const MAX_WINDOW_DAYS = 30;

const dayOf = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

const timeOf = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

interface DayRange {
  readonly from: string;
  readonly to: string;
}

const resolveRange = (query: StatsQuery, recent: boolean): DayRange => {
  const to = query.to ?? dayOf(Date.now());

  const fallback = recent
    ? dayOf(timeOf(to) - MAX_WINDOW_DAYS * DAY_MS)
    : LIFETIME_START;

  return { from: query.from ?? fallback, to };
};

const invalid = (client: SmartleadClient, message: string): OutboundError =>
  new OutboundError("Invalid", message, {
    provider: client.identity.provider,
  });

const unsupported = (client: SmartleadClient, message: string): OutboundError =>
  new OutboundError("Unsupported", message, {
    provider: client.identity.provider,
  });

const campaignPath = (scope: RowScope, leaf: string): string =>
  `/campaigns/${encodeURIComponent(scope.scopeId)}/${leaf}`;

const campaignTotal = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  if (query.from === undefined && query.to === undefined) {
    const lifetime = await client.get(ctx, campaignPath(scope, "analytics"));

    return [
      lifetimeRow(scope, objectOf(client, lifetime, "campaign analytics")),
    ];
  }

  const range = resolveRange(query, true);

  if (timeOf(range.to) - timeOf(range.from) > MAX_WINDOW_DAYS * DAY_MS) {
    throw invalid(
      client,
      `Smartlead reports a campaign's dated totals for at most ${MAX_WINDOW_DAYS} days; ${range.from} to ${range.to} is longer`
    );
  }

  const window = await client.get(
    ctx,
    campaignPath(scope, "analytics-by-date"),
    {
      query: {
        end_date: range.to,
        start_date: range.from,
        time_zone: TIMEZONE,
      },
    }
  );

  return [windowRow(scope, objectOf(client, window, "campaign analytics"))];
};

// The daily endpoint is account-wide; campaign_ids narrows it to one campaign.
const dailyRows = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const range = resolveRange(query, true);

  const request = {
    query: {
      campaign_ids: scope.scope === "campaign" ? scope.scopeId : undefined,
      end_date: range.to,
      start_date: range.from,
      timezone: TIMEZONE,
    },
  };

  // Positive replies per day are a report of their own, counted on the day of
  // the reply like the counts beside them.
  const [body, positive] = await Promise.all([
    client.get(ctx, "/analytics/day-wise-overall-stats", request),
    client.get(ctx, "/analytics/day-wise-positive-reply-stats", request),
  ]);

  const positiveByDay = new Map(
    objects(field(unwrap(positive), "day_wise_stats")).map((day) => [
      text(day.date),
      day.positive_replied,
    ])
  );

  return objects(field(unwrap(body), "day_wise_stats")).map((day) =>
    dayRow(scope, day, positiveByDay.get(text(day.date)))
  );
};

const workspaceTotal = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const range = resolveRange(query, false);

  const body = await client.get(ctx, "/analytics/overall-stats-v2", {
    query: { end_date: range.to, start_date: range.from, timezone: TIMEZONE },
  });

  const stats = field(objectOf(client, body, "overall stats"), "overall_stats");

  return [overallRow(scope, isJsonObject(stats) ? stats : {})];
};

// One row per campaign in a window, with the same counts as the account's
// totals. `full_data` asks for every campaign and not a page of them.
const everyCampaign = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const range = resolveRange(query, false);

  const body = await client.get(ctx, "/analytics/campaign/overall-stats", {
    query: {
      end_date: range.to,
      full_data: true,
      start_date: range.from,
      timezone: TIMEZONE,
    },
  });

  const campaigns = field(
    objectOf(client, body, "campaign performance"),
    "campaign_wise_performance"
  );

  return objects(campaigns).flatMap((campaign) => {
    const scopeId = text(campaign.id);

    return scopeId === null
      ? []
      : [
          overallRow(
            { ...client.identity, scope: "campaign", scopeId },
            campaign
          ),
        ];
  });
};

// This endpoint takes ISO 8601 datetimes, not days.
const stepTotals = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const range = resolveRange(query, false);

  const body = await client.get(
    ctx,
    campaignPath(scope, "sequence-analytics"),
    {
      query: {
        end_date: `${range.to}T23:59:59.999Z`,
        start_date: `${range.from}T00:00:00.000Z`,
        time_zone: TIMEZONE,
      },
    }
  );

  return objects(field(unwrap(body), "sequences")).flatMap((step) =>
    stepRows(scope, step)
  );
};

// The per-mailbox list is keyed by address and has no filter for one mailbox,
// so the mailbox is read first for its address and its row is picked here.
const senderTotal = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  scope: RowScope,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const account = objectOf(
    client,
    await client.get(
      ctx,
      `/email-accounts/${encodeURIComponent(scope.scopeId)}/`
    ),
    "the email account"
  );

  const address = emailAddress(account.from_email);
  const range = resolveRange(query, false);

  const body = await client.get(
    ctx,
    "/analytics/mailbox/name-wise-health-metrics",
    {
      query: { end_date: range.to, start_date: range.from, timezone: TIMEZONE },
    }
  );

  return [
    mailboxRow(
      scope,
      objects(field(unwrap(body), "email_health_metrics")).find(
        (metrics) =>
          address !== null && emailAddress(metrics.email_account) === address
      )
    ),
  ];
};

/** Reads the analytics endpoint that matches the scope and grouping. */
export const readStats = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: StatsQuery
): Promise<MetricRow[]> => {
  const scope: RowScope = {
    ...client.identity,
    scope: query.scope,
    scopeId: query.scopeId ?? client.identity.workspaceId,
  };

  if (query.scope === "campaign" && query.scopeId === undefined) {
    if (query.by === "day") {
      throw unsupported(
        client,
        "Smartlead reports every campaign in one call as totals only; read one campaign for its days"
      );
    }

    return await everyCampaign(client, ctx, query);
  }

  if (query.scope === "sender" || query.scope === "step") {
    if (query.by === "day") {
      throw unsupported(
        client,
        "Smartlead reports step and mailbox analytics as totals only"
      );
    }

    return query.scope === "step"
      ? await stepTotals(client, ctx, scope, query)
      : await senderTotal(client, ctx, scope, query);
  }

  if (query.by === "day") {
    return await dailyRows(client, ctx, scope, query);
  }

  return query.scope === "campaign"
    ? await campaignTotal(client, ctx, scope, query)
    : await workspaceTotal(client, ctx, scope, query);
};
