// Leads. Smartlead lists them per campaign only, so a listing without a
// campaign walks the campaigns one after the other.

import type { AdapterContext, LeadQuery, Page } from "../internal/adapter.ts";
import type { Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, field, isJsonObject, objects, text } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { SmartleadClient } from "./client.ts";
import { toCampaignLead, toLead, unwrap } from "./map.ts";
import {
  campaignIds,
  categoryNames,
  idList,
  objectOf,
  pageSize,
  segment,
} from "./shared.ts";
import type { CategoryNames } from "./shared.ts";

interface LeadPage {
  readonly items: Lead[];
  /** The next offset inside this campaign, when it has more leads. */
  readonly nextOffset: number | undefined;
}

interface LeadPlace {
  readonly campaignId: string;
  readonly categories: CategoryNames;
  readonly limit: number;
  readonly offset: number;
}

const campaignLeads = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  place: LeadPlace
): Promise<LeadPage> => {
  const body = await client.get(
    ctx,
    `/campaigns/${segment(place.campaignId)}/leads`,
    { query: { limit: place.limit, offset: place.offset } }
  );

  const rows = objects(field(body, "data"));
  // A string in the newer example and a number in the older one.
  const total = count(field(body, "total_leads"));
  const end = place.offset + rows.length;

  const more =
    rows.length > 0 &&
    (total === null ? rows.length === place.limit : end < total);

  return {
    items: rows.map((row) =>
      toCampaignLead(client.identity, place.campaignId, row, place.categories)
    ),
    nextOffset: more ? end : undefined,
  };
};

const offsetOf = (next: Json | undefined): number =>
  count(field(next, "offset")) ?? 0;

// The cursor carries the campaigns still to read and the category names.
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

  const categories = await categoryNames(client, ctx, query.next);

  const page = await campaignLeads(client, ctx, {
    campaignId: current,
    categories,
    limit: pageSize(query.limit),
    offset: offsetOf(query.next),
  });

  if (page.nextOffset !== undefined) {
    return {
      items: page.items,
      next: { campaigns, categories, offset: page.nextOffset },
    };
  }

  return {
    items: page.items,
    next:
      rest.length > 0 ? { campaigns: rest, categories, offset: 0 } : undefined,
  };
};

export const listLeads = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  if (query.campaignId === undefined) {
    return await allLeads(client, ctx, query);
  }

  const categories = await categoryNames(client, ctx, query.next);

  const page = await campaignLeads(client, ctx, {
    campaignId: query.campaignId,
    categories,
    limit: pageSize(query.limit),
    offset: offsetOf(query.next),
  });

  return {
    items: page.items,
    next:
      page.nextOffset === undefined
        ? undefined
        : { categories, offset: page.nextOffset },
  };
};

/** `GET /leads/{id}`, then the lead's tags from `GET /crm/leads/tags`. */
export const getLead = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  id: string
): Promise<Lead> => {
  const lead = objectOf(
    client,
    await client.get(ctx, `/leads/${segment(id)}`),
    "the lead"
  );

  // The lookup by address answers `{}` with 200 for a lead that does not
  // exist, so an object without an id is treated the same way here.
  if (text(lead.id) === null) {
    throw new OutboundError("NotFound", `Lead ${id} was not found`, {
      provider: client.identity.provider,
    });
  }

  const tags = await client.get(ctx, "/crm/leads/tags", {
    query: { leadId: id },
  });

  return toLead(
    client.identity,
    lead,
    objects(unwrap(tags)).flatMap((tag) => text(tag.name) ?? [])
  );
};
