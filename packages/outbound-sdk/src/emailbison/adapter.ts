// The EmailBison adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  LeadQuery,
  Page,
} from "../internal/adapter.ts";
import type { Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { mapPage } from "../internal/page.ts";
import { accountReaders } from "./account.ts";
import type { EmailBisonClient } from "./client.ts";
import { listMessages, listReplies } from "./mail.ts";
import { toSequence } from "./map-sequence.ts";
import { toCampaign, toLead, toSender } from "./map.ts";
import { readStats } from "./stats.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getCampaignSettings"
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
  | "listTags"
  | "listWebhooks"
  | "listWorkspaces"
  | "stats"
>;

const segment = (id: string): string => encodeURIComponent(id);

// GET /api/leads/{lead_id} takes the address in place of the id. A lead is
// one record per workspace, so a lookup returns it once, with no campaign.
const lookup = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  email: string
): Promise<Page<Lead>> => {
  const path = `/api/leads/${segment(email)}`;

  try {
    const lead = toLead(
      client.identity,
      client.one(await client.get(ctx, path), path)
    );

    // An address EmailBison matched loosely is not the one asked for.
    return { items: lead.email === email ? [lead] : [] };
  } catch (error) {
    if (OutboundError.is(error) && error.code === "NotFound") {
      return { items: [] };
    }

    throw error;
  }
};

const listLeads = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  if (query.email !== undefined) {
    return await lookup(client, ctx, query.email);
  }

  if (query.linkedinUrl !== undefined) {
    // No read finds a lead by its LinkedIn profile, and leads have no field
    // for one.
    return { items: [] };
  }

  const { campaignId } = query;

  if (campaignId !== undefined) {
    const page = await client.page(
      ctx,
      `/api/campaigns/${segment(campaignId)}/leads`,
      query.next,
      { cursor: true }
    );

    return mapPage(page, (row) => toLead(client.identity, row, campaignId));
  }

  return mapPage(
    await client.page(ctx, "/api/leads", query.next, { cursor: true }),
    (row) => toLead(client.identity, row)
  );
};

export const readers = (client: EmailBisonClient): Readers => {
  const { identity } = client;

  return {
    ...accountReaders(client),
    getCampaign: async (id, ctx) => {
      const path = `/api/campaigns/${segment(id)}`;

      return toCampaign(
        identity,
        client.one(await client.get(ctx, path), path)
      );
    },
    getLead: async (id, ctx) => {
      const path = `/api/leads/${segment(id)}`;

      return toLead(identity, client.one(await client.get(ctx, path), path));
    },
    getSender: async (id, ctx) => {
      const path = `/api/sender-emails/${segment(id)}`;

      return toSender(identity, client.one(await client.get(ctx, path), path));
    },
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        id,
        await client.get(
          ctx,
          `/api/campaigns/v1.1/${segment(id)}/sequence-steps`
        )
      ),
    listCampaigns: async (query, ctx) => {
      if (query.senderId !== undefined) {
        // Documented without cursor pagination.
        const page = await client.page(
          ctx,
          `/api/sender-emails/${segment(query.senderId)}/campaigns`,
          query.next
        );

        return mapPage(page, (row) => toCampaign(identity, row));
      }

      return mapPage(
        await client.page(ctx, "/api/campaigns", query.next, { cursor: true }),
        (row) => toCampaign(identity, row)
      );
    },
    listLeads: (query, ctx) => listLeads(client, ctx, query),
    listMessages: (query, ctx) => listMessages(client, ctx, query),
    listReplies: (query, ctx) => listReplies(client, ctx, query),
    listSenders: async (query, ctx) => {
      const path =
        query.campaignId === undefined
          ? "/api/sender-emails"
          : `/api/campaigns/${segment(query.campaignId)}/sender-emails`;

      return mapPage(
        await client.page(ctx, path, query.next, { cursor: true }),
        (row) => toSender(identity, row)
      );
    },
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
