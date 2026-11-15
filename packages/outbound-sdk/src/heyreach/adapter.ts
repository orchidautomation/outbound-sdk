// The HeyReach adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  StatsQuery,
} from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { JsonObject } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import { accountReaders, campaignSenders } from "./account.ts";
import type { HeyReachClient } from "./client.ts";
import { inboxReaders } from "./inbox.ts";
import { leadReaders } from "./leads.ts";
import { toSequence } from "./map-sequence.ts";
import { campaignRows, dailyRows, totalRow } from "./map-stats.ts";
import { listEnvelope, toCampaign, toSender, vendorStatuses } from "./map.ts";
import { numericId, offsetOf, pageSize } from "./paging.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getCampaignProgress"
  | "getLead"
  | "getList"
  | "getSender"
  | "getSenderHealth"
  | "getSequence"
  | "getWebhook"
  | "listBlocklist"
  | "listCampaigns"
  | "listLeads"
  | "listLists"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "listWebhooks"
  | "stats"
>;

const statsBody = (client: HeyReachClient, query: StatsQuery): JsonObject => {
  const { provider } = client.identity;

  if (query.scope === "step") {
    throw new OutboundError("Unsupported", "HeyReach has no step analytics", {
      provider,
    });
  }

  if ((query.from === undefined) !== (query.to === undefined)) {
    throw new OutboundError(
      "Invalid",
      "HeyReach stats need both from and to, or neither",
      { provider }
    );
  }

  const id = query.scopeId;

  // Empty arrays mean every account and every campaign.
  const body: JsonObject = {
    accountIds:
      query.scope === "sender" ? [numericId(client, id ?? "", "account")] : [],
    campaignIds:
      query.scope === "campaign" && id !== undefined
        ? [numericId(client, id, "campaign")]
        : [],
  };

  if (query.from !== undefined && query.to !== undefined) {
    // The documented example bounds a range with these two times of day.
    body.startDate = `${query.from}T00:00:00.000Z`;
    body.endDate = `${query.to}T23:59:59.999Z`;
  }

  return body;
};

const readStats = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: StatsQuery
): Promise<MetricRow[]> => {
  if (query.scope === "campaign" && query.scopeId === undefined) {
    // The same filters as GetOverallStats, answered with a row per campaign.
    return campaignRows(
      client.identity,
      await client.post(
        ctx,
        "/stats/GetOverallStatsByCampaign",
        statsBody(client, query)
      ),
      query.by
    );
  }

  const body = await client.post(
    ctx,
    "/stats/GetOverallStats",
    statsBody(client, query)
  );

  const scope = {
    ...client.identity,
    scope: query.scope,
    scopeId: query.scopeId ?? client.identity.workspaceId,
  };

  return query.by === "day" ? dailyRows(scope, body) : [totalRow(scope, body)];
};

export const readers = (client: HeyReachClient): Readers => {
  const { identity } = client;

  return {
    ...accountReaders(client),
    ...inboxReaders(client),
    ...leadReaders(client),
    getCampaign: async (id, ctx) => {
      const path = "/campaign/GetById";

      return toCampaign(
        identity,
        client.object(
          await client.get(ctx, path, { query: { campaignId: id } }),
          path
        )
      );
    },
    getSender: async (id, ctx) => {
      const path = "/li_account/GetById";

      return toSender(
        identity,
        client.object(
          await client.get(ctx, path, { query: { accountId: id } }),
          path
        )
      );
    },
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        id,
        await client.get(ctx, "/campaign/GetCampaignSequence", {
          query: { campaignId: id },
        })
      ),
    listCampaigns: async (query, ctx) => {
      const offset = offsetOf(query.next);
      const body: JsonObject = { limit: pageSize(query.limit), offset };

      if (query.status !== undefined) {
        const statuses = vendorStatuses(query.status);

        if (statuses.length === 0) {
          // HeyReach has no archived campaigns.
          return { items: [] };
        }

        body.statuses = statuses;
      }

      if (query.senderId !== undefined) {
        // `accountIds` narrows the list to the campaigns of those accounts.
        body.accountIds = [numericId(client, query.senderId, "account")];
      }

      const envelope = listEnvelope(
        await client.post(ctx, "/campaign/GetAll", body),
        offset
      );

      return mapPage(envelope, (item) => toCampaign(identity, item));
    },
    listSenders: async (query, ctx) => {
      const { campaignId } = query;

      if (campaignId !== undefined) {
        return await campaignSenders(client, ctx, { ...query, campaignId });
      }

      const offset = offsetOf(query.next);

      const envelope = listEnvelope(
        await client.post(ctx, "/li_account/GetAll", {
          limit: pageSize(query.limit),
          offset,
        }),
        offset
      );

      return mapPage(envelope, (item) => toSender(identity, item));
    },
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
