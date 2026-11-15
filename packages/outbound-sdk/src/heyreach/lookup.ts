// One person by LinkedIn profile or by email address, without walking a
// campaign's leads. `POST /campaign/GetCampaignsForLead` names the campaigns
// and the lead's status in each; `POST /lead/GetLead` gives the profile, read
// once and reused for every record.

import type { AdapterContext, LeadQuery, Page } from "../internal/adapter.ts";
import type { Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { field, isJsonObject, isNumber, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { profileSlug } from "../internal/url.ts";
import type { HeyReachClient } from "./client.ts";
import { listEnvelope, profileEmails, toLookupLead } from "./map.ts";
import { offsetOf, pageSize } from "./paging.ts";

const CAMPAIGNS_PATH = "/campaign/GetCampaignsForLead";

/** How many leads of the same name are read to find the one with the address. */
const MAX_CANDIDATES = 5;

/**
 * The one form sent to HeyReach. Seen live: it matches a stored profile
 * whatever the scheme, `www.`, trailing slash or query, but not when the
 * letters differ in case, and the stored slug was lowercase.
 */
export const canonicalProfileUrl = (url: string): string | null => {
  const slug = profileSlug(url);

  return slug === null
    ? null
    : `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
};

// HeyReach answers 404 "There is no lead matching your search criteria" for a
// person it does not know, which is an empty answer here, not an error.
const found = async (request: Promise<Json>): Promise<Json | undefined> => {
  try {
    return await request;
  } catch (error) {
    if (OutboundError.is(error) && error.code === "NotFound") {
      return undefined;
    }

    throw error;
  }
};

const readProfile = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  profileUrl: string
): Promise<JsonObject | undefined> => {
  const body = await found(client.post(ctx, "/lead/GetLead", { profileUrl }));

  return isJsonObject(body) ? body : undefined;
};

// No read returns a profile for an email address. The campaigns answer names
// the person, so the profile is found in a saved list the address is in:
// the list is searched for that name and each match's profile is read until
// one carries the address.
const profileByEmail = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  email: string,
  fullName: string | null
): Promise<JsonObject | undefined> => {
  if (fullName === null) {
    return undefined;
  }

  const lists = await found(
    client.post(ctx, "/list/GetListsForLead", { email, limit: 1, offset: 0 })
  );

  // `undefined` is the 404 for an address in no list.
  const listId =
    lists === undefined
      ? undefined
      : field(client.items(lists, "/list/GetListsForLead")[0], "listId");

  if (!isNumber(listId)) {
    return undefined;
  }

  const rows = client.items(
    await client.post(ctx, "/list/GetLeadsFromList", {
      keyword: fullName,
      limit: MAX_CANDIDATES,
      listId,
      offset: 0,
    }),
    "/list/GetLeadsFromList"
  );

  for (const row of rows) {
    const profileUrl = text(row.profileUrl);

    const profile =
      profileUrl === null
        ? undefined
        : // oxlint-disable-next-line no-await-in-loop -- stops at the first profile that carries the address.
          await readProfile(client, ctx, profileUrl);

    if (profile !== undefined && profileEmails(profile).includes(email)) {
      return profile;
    }
  }

  return undefined;
};

// Only an exact identifier counts: HeyReach's own matching is not trusted.
const isPerson = (profile: JsonObject, query: LeadQuery): boolean =>
  (query.linkedinUrl === undefined ||
    profileSlug(text(profile.profileUrl)) === profileSlug(query.linkedinUrl)) &&
  (query.email === undefined || profileEmails(profile).includes(query.email));

interface Answer {
  readonly campaigns: Json | undefined;
  readonly profile: JsonObject | undefined;
}

const ask = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: LeadQuery,
  offset: number
): Promise<Answer> => {
  const paging = { limit: pageSize(query.limit), offset };

  // A later page carries the profile URL the first page found.
  const profileUrl =
    query.linkedinUrl === undefined
      ? text(field(query.next, "profileUrl"))
      : canonicalProfileUrl(query.linkedinUrl);

  if (profileUrl !== null) {
    const key =
      query.linkedinUrl === undefined
        ? { email: query.email ?? "" }
        : { profileUrl };

    const [campaigns, profile] = await Promise.all([
      found(client.post(ctx, CAMPAIGNS_PATH, { ...key, ...paging })),
      readProfile(client, ctx, profileUrl),
    ]);

    return { campaigns, profile };
  }

  const { email } = query;

  if (email === undefined) {
    // `linkedinUrl` was set and is not a profile URL.
    return { campaigns: undefined, profile: undefined };
  }

  const campaigns = await found(
    client.post(ctx, CAMPAIGNS_PATH, { email, ...paging })
  );

  return {
    campaigns,
    profile:
      campaigns === undefined
        ? undefined
        : await profileByEmail(
            client,
            ctx,
            email,
            text(field(campaigns, "leadFullName"))
          ),
  };
};

/**
 * One page of the lead records of exactly one person: one per campaign the
 * person is in, or a single record with no campaign for a person HeyReach
 * knows who is in none.
 */
export const lookupLeads = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: LeadQuery
): Promise<Page<Lead>> => {
  const { provider } = client.identity;

  if (query.listId !== undefined) {
    throw new OutboundError(
      "Unsupported",
      "HeyReach cannot look a lead up inside one saved list. Look the lead up without the list",
      { provider }
    );
  }

  if (query.since !== undefined || query.until !== undefined) {
    throw new OutboundError(
      "Unsupported",
      "HeyReach does not say when a looked-up lead joined a campaign, so a lookup cannot be bounded by date",
      { provider }
    );
  }

  const offset = offsetOf(field(query.next, "offset"));
  const { campaigns, profile } = await ask(client, ctx, query, offset);

  if (profile === undefined || !isPerson(profile, query)) {
    return { items: [] };
  }

  // `undefined` is HeyReach's 404 for a person in no campaign: an empty
  // page, not a bad answer. Any answer it did send must be the list.
  const envelope =
    campaigns === undefined
      ? { items: [], next: undefined }
      : listEnvelope(campaigns, offset, provider, CAMPAIGNS_PATH);

  if (envelope.items.length === 0 && offset === 0) {
    return {
      items:
        query.campaignId === undefined
          ? [toLookupLead(client.identity, profile, null, query.email)]
          : [],
    };
  }

  return {
    items: envelope.items
      .filter(
        (campaign) =>
          query.campaignId === undefined ||
          text(campaign.campaignId) === query.campaignId
      )
      .map((campaign) =>
        toLookupLead(client.identity, profile, campaign, query.email)
      ),
    next:
      envelope.next === undefined
        ? undefined
        : { offset: envelope.next, profileUrl: text(profile.profileUrl) },
  };
};
