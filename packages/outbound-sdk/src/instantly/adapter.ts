// The Instantly adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  CampaignQuery,
  LeadQuery,
  Page,
} from "../internal/adapter.ts";
import type { Campaign, Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  emailAddress,
  isJsonObject,
  isNumber,
  isString,
  text,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { accountReaders } from "./adapter-account.ts";
import { mailReaders } from "./adapter-mail.ts";
import { TAG_PAGES } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import { toLead } from "./map-lead.ts";
import type { ListEnvelope } from "./map.ts";
import {
  campaignStatusCode,
  listEnvelope,
  toCampaign,
  toSender,
  toSequence,
  toWorkspace,
} from "./map.ts";
import { listPage, pageSize, readLabels, readLookup } from "./pages.ts";
import { senderReaders } from "./senders.ts";
import { readStats } from "./stats.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getLead"
  | "getSender"
  | "getSequence"
  | "listCampaigns"
  | "listLeads"
  | "listWorkspaces"
  | "stats"
>;

const texts = (items: readonly JsonObject[], key: string): string[] =>
  items.flatMap((item) => text(item[key]) ?? []);

/**
 * The tag names of each campaign, by campaign id. A tag is tied to a campaign
 * by a mapping record, and the mapping holds the tag's id, not its name.
 */
const campaignTags = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  ids: readonly string[]
): Promise<Map<string, string[]>> => {
  const tags = new Map<string, string[]>();

  if (!client.readTags || ids.length === 0) {
    return tags;
  }

  const mappings = await readLookup(client, ctx, {
    filters: { resource_ids: ids.join(",") },
    pages: TAG_PAGES,
    path: "/custom-tag-mappings",
  });

  if (mappings.length === 0) {
    return tags;
  }

  const found = await readLookup(client, ctx, {
    filters: { tag_ids: [...new Set(texts(mappings, "tag_id"))].join(",") },
    pages: TAG_PAGES,
    path: "/custom-tags",
  });

  const names = new Map(found.map((tag) => [text(tag.id), text(tag.label)]));

  for (const mapping of mappings) {
    const campaign = text(mapping.resource_id) ?? "";
    const name = names.get(text(mapping.tag_id));

    if (name !== null && name !== undefined) {
      tags.set(campaign, [...(tags.get(campaign) ?? []), name]);
    }
  }

  return tags;
};

// `GET /account-campaign-mappings/{email}`: the campaigns a mailbox is used
// by, each with its id, name, status and creation time and nothing else.
const senderCampaigns = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: CampaignQuery & { readonly senderId: string }
): Promise<Page<Campaign>> => {
  const page = await listPage(
    client,
    ctx,
    `/account-campaign-mappings/${encodeURIComponent(query.senderId)}`,
    query
  );

  const tags = await campaignTags(
    client,
    ctx,
    texts(page.items, "campaign_id")
  );

  const campaigns = page.items.map((item) =>
    toCampaign(
      client.identity,
      // The mapping names the campaign's id and name with a prefix.
      {
        ...item,
        id: item.campaign_id ?? null,
        name: item.campaign_name ?? null,
      },
      tags.get(text(item.campaign_id) ?? "")
    )
  );

  return {
    items:
      query.status === undefined
        ? campaigns
        : campaigns.filter((campaign) => campaign.status === query.status),
    next: page.next,
  };
};

const listCampaigns = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: CampaignQuery
): Promise<Page<Campaign>> => {
  if (query.status === "archived" || query.status === "unknown") {
    // Instantly has no archived or unknown campaigns.
    return { items: [] };
  }

  if (query.senderId !== undefined) {
    return await senderCampaigns(client, ctx, {
      ...query,
      senderId: query.senderId,
    });
  }

  const page = await listPage(client, ctx, "/campaigns", query, {
    status:
      query.status === undefined ? undefined : campaignStatusCode(query.status),
  });

  const tags = await campaignTags(client, ctx, texts(page.items, "id"));

  const campaigns = page.items.map((item) =>
    toCampaign(client.identity, item, tags.get(text(item.id) ?? ""))
  );

  return {
    // Active and paused each cover several Instantly statuses, so they are
    // matched here on the mapped value.
    items:
      query.status === undefined
        ? campaigns
        : campaigns.filter((campaign) => campaign.status === query.status),
    next: page.next,
  };
};

/**
 * The lead list filters that name a positive interest status: Interested,
 * Meeting Booked, Meeting Completed, Won (`FILTER_LEAD_CLOSED`, the closed
 * status) and every custom label marked positive. `filter` takes one value,
 * so a listing by interest walks them one after another.
 */
const POSITIVE_FILTERS = [
  "FILTER_LEAD_INTERESTED",
  "FILTER_LEAD_MEETING_BOOKED",
  "FILTER_LEAD_MEETING_COMPLETED",
  "FILTER_LEAD_CLOSED",
  "FILTER_LEAD_CUSTOM_LABEL_POSITIVE",
];

/** Where a listing by interest is: which filter, and the cursor within it. */
const interestAt = (
  next: Json | undefined
): { at: number; after: string | null } =>
  isJsonObject(next) && isNumber(next.at)
    ? { after: isString(next.after) ? next.after : null, at: next.at }
    : { after: null, at: 0 };

/** The body of `POST /leads/list`: every filter and the cursor go in it. */
const leadListBody = (query: LeadQuery): JsonObject => {
  const body: JsonObject = { limit: pageSize(query.limit) };

  if (query.campaignId !== undefined) {
    body.campaign = query.campaignId;
  }

  if (query.listId !== undefined) {
    body.list_id = query.listId;
  }

  if (query.email !== undefined) {
    body.contacts = [query.email];
  }

  if (query.emails !== undefined) {
    body.contacts = [...query.emails];
  }

  // `search` matches whole words of the lead's email and profile fields, so
  // `acme.com` also finds names and companies that mention it. The adapter
  // keeps only the addresses at exactly that domain.
  if (query.domain !== undefined) {
    body.search = query.domain;
  }

  if (query.status === "active") {
    body.filter = "FILTER_VAL_ACTIVE";
  }

  if (query.interest === "positive") {
    const { after, at } = interestAt(query.next);

    body.filter = POSITIVE_FILTERS[at] ?? null;

    if (after !== null) {
      body.starting_after = after;
    }
  } else if (isString(query.next)) {
    body.starting_after = query.next;
  }

  return body;
};

const listLeads = async (
  client: InstantlyClient,
  query: LeadQuery,
  ctx: AdapterContext
): Promise<Page<Lead>> => {
  if (query.linkedinUrl !== undefined) {
    // An Instantly lead has no LinkedIn profile, so nothing can match.
    return { items: [] };
  }

  const envelope = listEnvelope(
    await client.post(ctx, "/leads/list", leadListBody(query)),
    client.identity.provider,
    "/leads/list"
  );

  const labels = await readLabels(
    client,
    ctx,
    envelope.items.map((item) => item.lt_interest_status)
  );

  const leads = envelope.items.map((item) =>
    toLead(client.identity, item, labels)
  );

  return {
    items: chosen(query, leads),
    next:
      query.interest === "positive" || query.emails !== undefined
        ? nextOf(query, envelope)
        : envelope.next,
  };
};

/**
 * The leads that meet every filter given. `contacts` is documented as the
 * emails a lead needs to have, but not how it compares them, `search`
 * matches more than the address, and `filter` is one status at a time, so
 * every match is made exact here.
 */
const chosen = (query: LeadQuery, leads: readonly Lead[]): Lead[] => {
  const wanted = new Set(query.emails);

  return leads.filter(
    (lead) =>
      (query.email === undefined || lead.email === query.email) &&
      (query.emails === undefined ||
        (lead.email !== null && wanted.has(lead.email))) &&
      (query.domain === undefined ||
        lead.email?.split("@").at(-1) === query.domain) &&
      (query.interest === undefined || lead.interestCategory === "positive") &&
      (query.status === undefined || lead.status === query.status)
  );
};

/**
 * The next page of a listing by interest or by many addresses. Instantly
 * sends a cursor on a last page too, so a page that is not full ends the
 * walk, or under interest moves on to the next filter.
 */
const nextOf = (
  query: LeadQuery,
  envelope: ListEnvelope
): JsonObject | string | undefined => {
  const next =
    envelope.items.length >= pageSize(query.limit) ? envelope.next : undefined;

  if (query.interest !== "positive") {
    return next;
  }

  const { at } = interestAt(query.next);

  if (next !== undefined) {
    return { after: next, at };
  }

  return at + 1 < POSITIVE_FILTERS.length ? { at: at + 1 } : undefined;
};

const leadReaders = (
  client: InstantlyClient
): Pick<Readers, "getLead" | "listLeads"> => ({
  getLead: async (id, ctx) => {
    // A message's leadRef holds the lead's address: an email names its lead
    // by address only. The first record with that address stands for it.
    const address = emailAddress(id);

    if (address !== null) {
      const page = await listLeads(client, { email: address }, ctx);
      const [lead] = page.items;

      if (lead === undefined) {
        throw new OutboundError("NotFound", "No lead has that address", {
          provider: client.identity.provider,
        });
      }

      return lead;
    }

    const lead = await client.getObject(
      ctx,
      `/leads/${encodeURIComponent(id)}`
    );

    return toLead(
      client.identity,
      lead,
      await readLabels(client, ctx, [lead.lt_interest_status])
    );
  },
  listLeads: async (query, ctx) => await listLeads(client, query, ctx),
});

export const readers = (
  client: InstantlyClient
): Readers &
  ReturnType<typeof accountReaders> &
  ReturnType<typeof mailReaders> &
  ReturnType<typeof senderReaders> => {
  const { identity } = client;

  return {
    ...accountReaders(client),
    ...leadReaders(client),
    ...mailReaders(client),
    ...senderReaders(client),
    getCampaign: async (id, ctx) => {
      const campaign = await client.getObject(
        ctx,
        `/campaigns/${encodeURIComponent(id)}`
      );

      const tags = await campaignTags(client, ctx, texts([campaign], "id"));

      return toCampaign(identity, campaign, tags.get(text(campaign.id) ?? ""));
    },
    getSender: async (id, ctx) =>
      toSender(
        identity,
        await client.getObject(ctx, `/accounts/${encodeURIComponent(id)}`),
        ctx.note
      ),
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        await client.getObject(ctx, `/campaigns/${encodeURIComponent(id)}`),
        ctx.note
      ),
    listCampaigns: async (query, ctx) =>
      await listCampaigns(client, ctx, query),
    listWorkspaces: async (_query, ctx) => {
      const workspace = await client.get(ctx, "/workspaces/current");

      return {
        items: isJsonObject(workspace)
          ? [toWorkspace(identity, workspace)]
          : [],
      };
    },
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
