// A lead found by its exact address. `GET /leads/?email=` returns the lead
// and every campaign it is in, so a lookup never walks a campaign's leads.

import type { AdapterContext, LeadQuery, Page } from "../internal/adapter.ts";
import type { Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  emailAddress,
  isJsonArray,
  isJsonObject,
  objects,
  text,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import type { SmartleadClient } from "./client.ts";
import { NO_CATEGORIES, toFoundLead, unwrap } from "./map.ts";
import { leadCategories, legacyRows, segment } from "./shared.ts";

const NONE: Page<Lead> = { items: [] };

interface Membership {
  readonly campaignId: string;
  /** The campaign's item as Smartlead sent it. */
  readonly entry: JsonObject;
}

// `lead_campaign_data` names the campaign `campaign_id`. Without that list
// the campaigns come from `GET /leads/{id}/campaigns`, which names it `id`.
const memberships = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  lead: JsonObject
): Promise<Membership[]> => {
  const listed = lead.lead_campaign_data;

  const path = `/leads/${segment(text(lead.id) ?? "")}/campaigns`;

  const entries = isJsonArray(listed)
    ? objects(listed)
    : legacyRows(client, await client.get(ctx, path), path);

  return entries.flatMap((entry) => {
    const campaignId = text(entry.campaign_id) ?? text(entry.id);

    return campaignId === null ? [] : [{ campaignId, entry }];
  });
};

/**
 * The records of one address, one per campaign the lead is in: one request,
 * and a second for the category names when a campaign gives a category.
 */
export const leadsByEmail = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  // No endpoint finds a lead by its LinkedIn profile.
  if (query.email === undefined || query.linkedinUrl !== undefined) {
    return NONE;
  }

  const lead = unwrap(
    await client.get(ctx, "/leads/", { query: { email: query.email } })
  );

  // Not a list, so read leniently: an unknown address answers `{}` with 200,
  // which stays "no lead". An answer that is not an object at all (a body
  // that is not JSON, an empty one, an array) is the vendor's fault.
  if (!isJsonObject(lead)) {
    throw new OutboundError(
      "Provider",
      "Smartlead returned no object for /leads/?email=",
      { provider: client.identity.provider }
    );
  }

  // How Smartlead matches the address is not documented, so anything but
  // the exact one is dropped.
  if (text(lead.id) === null || emailAddress(lead.email) !== query.email) {
    return NONE;
  }

  const found = await memberships(client, ctx, lead);

  const wanted = found.filter(
    (membership) =>
      query.campaignId === undefined ||
      membership.campaignId === query.campaignId
  );

  const categorized = wanted.some(
    (membership) => text(membership.entry.lead_category_id) !== null
  );

  const categories = categorized
    ? await leadCategories(client, ctx, undefined)
    : NO_CATEGORIES;

  return {
    items: wanted.map((membership) =>
      toFoundLead(client.identity, lead, { ...membership, categories })
    ),
  };
};
