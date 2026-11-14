// The HeyReach adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  StatsQuery,
} from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { isNumber } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { HeyReachClient } from "./client.ts";
import { inboxReaders } from "./inbox.ts";
import { toSequence } from "./map-sequence.ts";
import { dailyRows, totalRow } from "./map-stats.ts";
import {
  listEnvelope,
  toCampaign,
  toCampaignLead,
  toLead,
  toSender,
  vendorStatuses,
} from "./map.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getLead"
  | "getSender"
  | "getSequence"
  | "listCampaigns"
  | "listLeads"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "stats"
>;

const pageSize = (limit: number | undefined): number =>
  Math.min(limit ?? PAGE_SIZE, PAGE_SIZE);

const offsetOf = (next: Json | undefined): number =>
  isNumber(next) ? next : 0;

// Campaign and account ids are integers, and JSON bodies need them as numbers.
const numericId = (
  client: HeyReachClient,
  id: string,
  what: string
): number => {
  if (!/^\d+$/u.test(id)) {
    throw new OutboundError(
      "Invalid",
      `HeyReach ${what} ids are whole numbers, got "${id}"`,
      { provider: client.identity.provider }
    );
  }

  return Number(id);
};

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

  const id = query.scopeId ?? "";

  const body: JsonObject = {
    accountIds:
      query.scope === "sender" ? [numericId(client, id, "account")] : [],
    campaignIds:
      query.scope === "campaign" ? [numericId(client, id, "campaign")] : [],
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

const leadReaders = (
  client: HeyReachClient
): Pick<Readers, "getLead" | "listLeads"> => ({
  // The lead's id is its LinkedIn profile URL, the only key GetLead takes.
  getLead: async (id, ctx) => {
    const path = "/lead/GetLead";

    return toLead(
      client.identity,
      client.object(await client.post(ctx, path, { profileUrl: id }), path)
    );
  },
  listLeads: async (query, ctx) => {
    if (query.campaignId === undefined) {
      throw new OutboundError(
        "Unsupported",
        "HeyReach has no list of every lead. List a campaign's leads: outbound.campaign(id).leads.list()",
        { provider: client.identity.provider }
      );
    }

    const offset = offsetOf(query.next);

    const body: JsonObject = {
      campaignId: numericId(client, query.campaignId, "campaign"),
      limit: pageSize(query.limit),
      offset,
    };

    if (query.since !== undefined || query.until !== undefined) {
      body.timeFilter = "CreationTime";
    }

    if (query.since !== undefined) {
      body.timeFrom = query.since;
    }

    if (query.until !== undefined) {
      body.timeTo = query.until;
    }

    const { campaignId } = query;

    const envelope = listEnvelope(
      await client.post(ctx, "/campaign/GetLeadsFromCampaign", body),
      offset
    );

    return {
      items: envelope.items.map((item) =>
        toCampaignLead(client.identity, item, campaignId)
      ),
      next: envelope.next,
    };
  },
});

export const readers = (client: HeyReachClient): Readers => {
  const { identity } = client;

  return {
    ...inboxReaders(client),
    ...leadReaders(client),
    getCampaign: async (id, ctx) => {
      const path = "/campaign/GetById";

      return toCampaign(
        identity,
        client.object(await client.get(ctx, path, { campaignId: id }), path)
      );
    },
    getSender: async (id, ctx) => {
      const path = "/li_account/GetById";

      return toSender(
        identity,
        client.object(await client.get(ctx, path, { accountId: id }), path)
      );
    },
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        id,
        await client.get(ctx, "/campaign/GetCampaignSequence", {
          campaignId: id,
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

      const envelope = listEnvelope(
        await client.post(ctx, "/campaign/GetAll", body),
        offset
      );

      return {
        items: envelope.items.map((item) => toCampaign(identity, item)),
        next: envelope.next,
      };
    },
    listSenders: async (query, ctx) => {
      const offset = offsetOf(query.next);

      const envelope = listEnvelope(
        await client.post(ctx, "/li_account/GetAll", {
          limit: pageSize(query.limit),
          offset,
        }),
        offset
      );

      return {
        items: envelope.items.map((item) => toSender(identity, item)),
        next: envelope.next,
      };
    },
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
