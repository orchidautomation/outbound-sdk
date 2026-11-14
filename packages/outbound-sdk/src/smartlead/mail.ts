// Messages and replies. Smartlead spreads them over three sources:
// - `GET /campaigns/all-leads-activities`: every sent email and its reply,
//   across campaigns, with its own 10 per 60 seconds limit;
// - `GET /campaigns/{id}/leads/{lead}/message-history`: one lead's thread;
// - `POST /master-inbox/inbox-replies`: replies with their category.

import type {
  AdapterContext,
  MessageQuery,
  Page,
  ReplyQuery,
} from "../internal/adapter.ts";
import type { Message, Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  count,
  field,
  flag,
  isJsonArray,
  isJsonObject,
  list,
  objects,
  text,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import {
  ACTIVITIES_LANE,
  ACTIVITIES_MAX_PAGE_SIZE,
  ACTIVITIES_PAGE_SIZE,
  INBOX_PAGE_SIZE,
} from "./capabilities.ts";
import type { SmartleadClient } from "./client.ts";
import {
  categoriesFromJson,
  categoriesToJson,
  categoryIds,
  toActivityMessages,
  toCategoryMap,
  toHistoryMessage,
  toInboxReply,
} from "./map-messages.ts";
import type { CategoryMap } from "./map-messages.ts";
import { unwrap } from "./map.ts";

const DAY_MS = 86_400_000;

/** `filters.leadCategories.categoryIdsIn` takes at most ten ids. */
const MAX_CATEGORY_IDS = 10;
const EPOCH = "1970-01-01T00:00:00.000Z";

/** The ids in a cursor or a vendor list, as strings. */
export const idList = (value: Json | undefined): string[] =>
  list(value).flatMap((id) => text(id) ?? []);

const listActivities = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: MessageQuery
): Promise<Page<Message>> => {
  const offset = count(query.next) ?? 0;

  const body = await client.get(ctx, "/campaigns/all-leads-activities", {
    lane: ACTIVITIES_LANE,
    query: {
      // Narrows the feed to leads with activity since then. `event_time_to`
      // is not sent: a lead active after the end could drop out of the feed.
      event_time_from: query.since,
      limit: Math.min(
        query.limit ?? ACTIVITIES_PAGE_SIZE,
        ACTIVITIES_MAX_PAGE_SIZE
      ),
      offset,
    },
  });

  const rows = objects(field(body, "data"));
  const more = flag(field(body, "hasMore")) === true && rows.length > 0;

  return {
    // The feed has no campaign filter, so one campaign's rows are picked here.
    items: rows
      .filter(
        (row) =>
          query.campaignId === undefined ||
          text(row.campaign_id) === query.campaignId
      )
      .flatMap((row) =>
        toActivityMessages(client.identity, row, query.includeBody)
      ),
    next: more ? offset + rows.length : undefined,
  };
};

const leadCampaigns = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: MessageQuery,
  leadId: string
): Promise<string[]> => {
  if (isJsonObject(query.next)) {
    return idList(query.next.campaigns);
  }

  if (query.campaignId !== undefined) {
    return [query.campaignId];
  }

  const campaigns = await client.get(
    ctx,
    `/leads/${encodeURIComponent(leadId)}/campaigns`
  );

  return objects(unwrap(campaigns)).flatMap(
    (campaign) => text(campaign.id) ?? []
  );
};

// One page is the lead's whole thread in one campaign.
const listHistory = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: MessageQuery,
  leadId: string
): Promise<Page<Message>> => {
  const [campaignId, ...rest] = await leadCampaigns(client, ctx, query, leadId);

  if (campaignId === undefined) {
    return { items: [] };
  }

  const body = await client.get(
    ctx,
    `/campaigns/${encodeURIComponent(campaignId)}/leads/${encodeURIComponent(leadId)}/message-history`
  );

  const history = field(unwrap(body), "history");

  if (!isJsonArray(history)) {
    // The newer documentation shows another shape whose fields look
    // illustrative. Failing is better than returning an empty timeline.
    throw new OutboundError(
      "Provider",
      "Smartlead returned a message history without a history list",
      { provider: client.identity.provider }
    );
  }

  return {
    items: objects(history).map((item) =>
      toHistoryMessage(
        client.identity,
        { campaignId, leadId },
        item,
        query.includeBody
      )
    ),
    next: rest.length > 0 ? { campaigns: rest } : undefined,
  };
};

export const listMessages = (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: MessageQuery
): Promise<Page<Message>> =>
  query.leadId === undefined
    ? listActivities(client, ctx, query)
    : listHistory(client, ctx, query, query.leadId);

// The category list is read once per walk and then travels in the cursor.
const readCategories = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  next: Json | undefined
): Promise<CategoryMap> =>
  isJsonObject(next)
    ? categoriesFromJson(next.categories)
    : toCategoryMap(unwrap(await client.get(ctx, "/leads/fetch-categories")));

const inboxFilters = (query: ReplyQuery, wanted: number[]): JsonObject => {
  const filters: JsonObject = {};

  if (query.campaignId !== undefined) {
    filters.campaignId = count(query.campaignId) ?? query.campaignId;
  }

  if (wanted.length > 0 && wanted.length <= MAX_CATEGORY_IDS) {
    filters.leadCategories = { categoryIdsIn: wanted };
  }

  if (query.since !== undefined || query.until !== undefined) {
    filters.replyTimeBetween = [
      query.since ?? EPOCH,
      query.until ?? new Date(Date.now() + DAY_MS).toISOString(),
    ];
  }

  return filters;
};

export const listReplies = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: ReplyQuery
): Promise<Page<Reply>> => {
  const categories = await readCategories(client, ctx, query.next);

  const wanted =
    query.category === undefined ? [] : categoryIds(categories, query.category);

  if (
    query.category !== undefined &&
    query.category !== "unknown" &&
    wanted.length === 0
  ) {
    // No category of this account means that, so no reply can match.
    return { items: [] };
  }

  const offset = count(field(query.next, "offset")) ?? 0;
  const limit = Math.min(query.limit ?? INBOX_PAGE_SIZE, INBOX_PAGE_SIZE);

  const body = await client.post(ctx, "/master-inbox/inbox-replies", {
    filters: inboxFilters(query, wanted),
    limit,
    offset,
  });

  const threads = objects(field(unwrap(body), "messages"));
  const total = count(field(unwrap(body), "total_count"));
  const end = offset + threads.length;

  const more =
    threads.length > 0 &&
    (total === null ? threads.length === limit : end < total);

  const replies = threads.map((thread) =>
    toInboxReply(client.identity, thread, categories, query.includeBody)
  );

  return {
    // The id filter only narrows; the category is matched on the mapped value.
    items:
      query.category === undefined
        ? replies
        : replies.filter((reply) => reply.category === query.category),
    next: more
      ? { categories: categoriesToJson(categories), offset: end }
      : undefined,
  };
};
