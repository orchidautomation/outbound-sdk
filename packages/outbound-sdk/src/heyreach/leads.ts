// HeyReach leads: a campaign's, a saved list's, one by profile URL, and every
// lead by walking the campaigns. One page per call.

import type {
  Adapter,
  AdapterContext,
  LeadQuery,
  Page,
} from "../internal/adapter.ts";
import type { Lead } from "../internal/entities.ts";
import { count, field, isJsonObject, list, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { LIST_LEADS_PAGE_SIZE, PAGE_SIZE } from "./capabilities.ts";
import type { HeyReachClient } from "./client.ts";
import { lookupLeads } from "./lookup.ts";
import { listEnvelope, toCampaignLead, toLead } from "./map.ts";
import { numericId, offsetOf, pageSize } from "./paging.ts";

// `POST /list/GetLeadsFromList`: up to 1000 leads a page, filtered by the
// time the lead was added.
const listLeadsBody = (
  client: HeyReachClient,
  query: LeadQuery & { readonly listId: string },
  offset: number
): JsonObject => {
  const body: JsonObject = {
    limit: pageSize(query.limit, LIST_LEADS_PAGE_SIZE),
    listId: numericId(client, query.listId, "list"),
    offset,
  };

  if (query.since !== undefined) {
    body.createdFrom = query.since;
  }

  if (query.until !== undefined) {
    body.createdTo = query.until;
  }

  return body;
};

const campaignLeadsBody = (
  client: HeyReachClient,
  query: LeadQuery & { readonly campaignId: string },
  offset: number
): JsonObject => {
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

  return body;
};

const campaignLeads = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: LeadQuery & { readonly campaignId: string },
  offset: number
): Promise<{ readonly items: Lead[]; readonly next: number | undefined }> => {
  const envelope = listEnvelope(
    await client.post(
      ctx,
      "/campaign/GetLeadsFromCampaign",
      campaignLeadsBody(client, query, offset)
    ),
    offset
  );

  return {
    items: envelope.items.map((item) =>
      toCampaignLead(client.identity, item, query.campaignId)
    ),
    next: envelope.next,
  };
};

// Where a walk over every campaign's leads stands: the campaigns of the
// current campaign page still to read, the next campaign page, and the
// offset inside the first campaign.
interface Walk {
  readonly campaigns: readonly string[];
  readonly campaignOffset: number | undefined;
  readonly offset: number;
}

const walkOf = (next: Json | undefined): Walk | undefined =>
  isJsonObject(next)
    ? {
        campaignOffset: count(next.campaignOffset) ?? undefined,
        campaigns: list(next.campaigns).flatMap((id) => text(id) ?? []),
        offset: count(next.offset) ?? 0,
      }
    : undefined;

const walkCursor = (walk: Walk): Json | undefined =>
  walk.campaigns.length === 0 && walk.campaignOffset === undefined
    ? undefined
    : {
        campaignOffset: walk.campaignOffset ?? null,
        campaigns: [...walk.campaigns],
        offset: walk.offset,
      };

// The next page of campaigns, when the ones in hand have all been read.
const nextCampaigns = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  walk: Walk | undefined
): Promise<Walk> => {
  if (walk !== undefined && walk.campaigns.length > 0) {
    return walk;
  }

  const offset = walk === undefined ? 0 : walk.campaignOffset;

  if (offset === undefined) {
    return { campaignOffset: undefined, campaigns: [], offset: 0 };
  }

  const envelope = listEnvelope(
    await client.post(ctx, "/campaign/GetAll", { limit: PAGE_SIZE, offset }),
    offset
  );

  return {
    campaignOffset: envelope.next,
    campaigns: envelope.items.flatMap((item) => text(item.id) ?? []),
    offset: 0,
  };
};

// HeyReach lists leads per campaign only, so a listing without a campaign
// walks the campaigns one after the other: one page of one campaign's leads
// per call, and one more request each time a page of campaigns runs out.
const allLeads = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  const walk = await nextCampaigns(client, ctx, walkOf(query.next));
  const [campaignId, ...rest] = walk.campaigns;

  if (campaignId === undefined) {
    return { items: [] };
  }

  const page = await campaignLeads(
    client,
    ctx,
    { ...query, campaignId },
    walk.offset
  );

  return {
    items: page.items,
    next: walkCursor(
      page.next === undefined
        ? { ...walk, campaigns: rest, offset: 0 }
        : { ...walk, offset: page.next }
    ),
  };
};

/** One lead by profile URL, and the lead listings. */
export const leadReaders = (
  client: HeyReachClient
): Required<Pick<Adapter, "getLead" | "listLeads">> => ({
  // The lead's id is its LinkedIn profile URL, the only key GetLead takes.
  // GetLead carries no tags, so they are read beside it. A looked-up lead's
  // id also names its campaign, which is dropped here.
  getLead: async (id, ctx) => {
    const path = "/lead/GetLead";
    const profileUrl = id;

    const [lead, tags] = await Promise.all([
      client.post(ctx, path, { profileUrl }),
      client.post(ctx, "/lead/GetTags", { profileUrl }),
    ]);

    return toLead(
      client.identity,
      client.object(lead, path),
      field(tags, "tags") ?? []
    );
  },
  listLeads: async (query, ctx) => {
    if (query.email !== undefined || query.linkedinUrl !== undefined) {
      return await lookupLeads(client, ctx, query);
    }

    const offset = offsetOf(query.next);
    const { campaignId, listId } = query;

    if (listId !== undefined) {
      const envelope = listEnvelope(
        await client.post(
          ctx,
          "/list/GetLeadsFromList",
          listLeadsBody(client, { ...query, listId }, offset)
        ),
        offset
      );

      return {
        items: envelope.items.map((item) => toLead(client.identity, item)),
        next: envelope.next,
      };
    }

    if (campaignId === undefined) {
      return await allLeads(client, ctx, query);
    }

    return await campaignLeads(client, ctx, { ...query, campaignId }, offset);
  },
});
