// The Smartlead adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  LeadQuery,
  Page,
  SenderQuery,
} from "../internal/adapter.ts";
import type { Lead, Sender } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, field, isJsonObject, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { SmartleadClient } from "./client.ts";
import { idList, listMessages, listReplies } from "./mail.ts";
import {
  toCampaign,
  toCampaignLead,
  toLead,
  toSender,
  toSequence,
  toWorkspace,
  unwrap,
} from "./map.ts";
import { readStats } from "./stats.ts";

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
  | "listWorkspaces"
  | "stats"
>;

const pageSize = (limit: number | undefined): number =>
  Math.min(limit ?? PAGE_SIZE, PAGE_SIZE);

const segment = (id: string): string => encodeURIComponent(id);

/** The payload of an endpoint that returns one object, bare or wrapped. */
const objectOf = (
  client: SmartleadClient,
  body: Json,
  what: string
): JsonObject => {
  const payload = unwrap(body);

  if (!isJsonObject(payload)) {
    throw new OutboundError(
      "Provider",
      `Smartlead returned no object for ${what}`,
      { provider: client.identity.provider }
    );
  }

  return payload;
};

// `GET /campaigns/` returns every campaign at once: no pages, no filters.
const campaignList = async (
  client: SmartleadClient,
  ctx: AdapterContext
): Promise<JsonObject[]> =>
  objects(
    unwrap(
      await client.get(ctx, "/campaigns/", { query: { include_tags: true } })
    )
  );

const campaignIds = async (
  client: SmartleadClient,
  ctx: AdapterContext
): Promise<string[]> => {
  const campaigns = await campaignList(client, ctx);

  return campaigns.flatMap((campaign) => text(campaign.id) ?? []);
};

interface LeadPage {
  readonly items: Lead[];
  /** The next offset inside this campaign, when it has more leads. */
  readonly nextOffset: number | undefined;
}

const campaignLeads = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  campaignId: string,
  page: { readonly limit: number; readonly offset: number }
): Promise<LeadPage> => {
  const body = await client.get(
    ctx,
    `/campaigns/${segment(campaignId)}/leads`,
    {
      query: { limit: page.limit, offset: page.offset },
    }
  );

  const rows = objects(field(body, "data"));
  // A string in the newer example and a number in the older one.
  const total = count(field(body, "total_leads"));
  const end = page.offset + rows.length;

  const more =
    rows.length > 0 &&
    (total === null ? rows.length === page.limit : end < total);

  return {
    items: rows.map((row) => toCampaignLead(client.identity, campaignId, row)),
    nextOffset: more ? end : undefined,
  };
};

// Smartlead has no list of all leads, so this walks the campaigns one after
// the other. The cursor carries the campaigns still to read.
const allLeads = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  const campaigns = isJsonObject(query.next)
    ? idList(query.next.campaigns)
    : await campaignIds(client, ctx);

  const [current, ...rest] = campaigns;

  if (current === undefined) {
    return { items: [] };
  }

  const page = await campaignLeads(client, ctx, current, {
    limit: pageSize(query.limit),
    offset: count(field(query.next, "offset")) ?? 0,
  });

  if (page.nextOffset !== undefined) {
    return { items: page.items, next: { campaigns, offset: page.nextOffset } };
  }

  return {
    items: page.items,
    next: rest.length > 0 ? { campaigns: rest, offset: 0 } : undefined,
  };
};

const listLeads = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  if (query.campaignId === undefined) {
    return await allLeads(client, ctx, query);
  }

  const page = await campaignLeads(client, ctx, query.campaignId, {
    limit: pageSize(query.limit),
    offset: count(query.next) ?? 0,
  });

  return { items: page.items, next: page.nextOffset };
};

const listSenders = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: SenderQuery
): Promise<Page<Sender>> => {
  if (query.campaignId !== undefined) {
    // A campaign's mailboxes come in one response, bare or wrapped.
    const attached = await client.get(
      ctx,
      `/campaigns/${segment(query.campaignId)}/email-accounts`
    );

    return {
      items: objects(unwrap(attached)).map((account) =>
        toSender(client.identity, account)
      ),
    };
  }

  const limit = pageSize(query.limit);
  const offset = count(query.next) ?? 0;

  const accounts = objects(
    unwrap(
      await client.get(ctx, "/email-accounts/", { query: { limit, offset } })
    )
  );

  return {
    items: accounts.map((account) => toSender(client.identity, account)),
    // There is no total and no marker: a full page means there may be more.
    next: accounts.length === limit ? offset + limit : undefined,
  };
};

export const readers = (client: SmartleadClient): Readers => {
  const { identity } = client;

  return {
    getCampaign: async (id, ctx) =>
      toCampaign(
        identity,
        objectOf(
          client,
          await client.get(ctx, `/campaigns/${segment(id)}`, {
            query: { include_tags: true },
          }),
          "the campaign"
        )
      ),
    getLead: async (id, ctx) => {
      const lead = objectOf(
        client,
        await client.get(ctx, `/leads/${segment(id)}`),
        "the lead"
      );

      // The lookup by address answers `{}` with 200 for a lead that does not
      // exist, so an object without an id is treated the same way here.
      if (text(lead.id) === null) {
        throw new OutboundError("NotFound", `Lead ${id} was not found`, {
          provider: identity.provider,
        });
      }

      return toLead(identity, lead);
    },
    getSender: async (id, ctx) =>
      toSender(
        identity,
        objectOf(
          client,
          // The documented path ends with a slash.
          await client.get(ctx, `/email-accounts/${segment(id)}/`),
          "the email account"
        )
      ),
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        id,
        await client.get(ctx, `/campaigns/${segment(id)}/sequences`)
      ),
    listCampaigns: async (_query, ctx) => {
      const campaigns = await campaignList(client, ctx);

      return {
        items: campaigns.map((campaign) => toCampaign(identity, campaign)),
      };
    },
    listLeads: (query, ctx) => listLeads(client, ctx, query),
    listMessages: (query, ctx) => listMessages(client, ctx, query),
    listReplies: (query, ctx) => listReplies(client, ctx, query),
    listSenders: (query, ctx) => listSenders(client, ctx, query),
    listWorkspaces: async (_query, ctx) => ({
      items: objects(unwrap(await client.get(ctx, "/client/"))).map((raw) =>
        toWorkspace(identity, raw)
      ),
    }),
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
