// HeyReach conversations, and the campaign each belongs to.
//
// The reference says a GetConversationsV3 item names its campaign in
// `campaignId`. Seen live on 2026-11-17, no item carries it, filtered by
// campaign or not, so a conversation's campaign is known only from the
// `campaignIds` filter it was listed under. A listing without a campaign
// therefore walks the workspace's campaigns one after the other, and then,
// when the inbox is wanted, the unfiltered listing less the conversations
// that belong to a campaign.

import type {
  AdapterContext,
  MessageQuery,
  ReplyQuery,
} from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  count,
  field,
  isJsonObject,
  isString,
  list,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { HeyReachClient } from "./client.ts";
import { listEnvelope } from "./map.ts";

export const CONVERSATIONS_PATH = "/inbox/GetConversationsV3";

const CAMPAIGNS_PATH = "/campaign/GetAll";

const LEAD_CAMPAIGNS_PATH = "/campaign/GetCampaignsForLead";

export type ConversationQuery = MessageQuery | ReplyQuery;

/** A conversation and the campaign it was listed under, if any. */
export interface Listed {
  readonly conversation: JsonObject;
  readonly campaignId: string | null;
}

export interface ConversationPage {
  readonly items: readonly Listed[];
  readonly next: Json | undefined;
}

interface Bounds {
  readonly campaignIds?: readonly number[] | undefined;
  readonly cursor?: string | undefined;
  readonly from?: string | undefined;
  readonly limit?: number | undefined;
  readonly to?: string | undefined;
}

const numeric = (id: string): number | null =>
  /^\d+$/u.test(id) ? Number(id) : null;

// The listing bounds conversations by the time of their newest message. Every
// message at or after `since` sits in a conversation whose newest message is
// too, so `since` is sent as `from`. `until` cannot be sent: a conversation
// that went on past it still holds the earlier messages.
const readPage = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  bounds: Bounds
) => {
  const filters: JsonObject = {};

  if (bounds.campaignIds !== undefined) {
    filters.campaignIds = [...bounds.campaignIds];
  }

  if ("unread" in query && query.unread !== undefined) {
    // `seen` is true for read conversations and false for unread ones.
    filters.seen = !query.unread;
  }

  if ("leadId" in query && query.leadId !== undefined) {
    // A looked-up lead's id also names its campaign; the filter takes the URL.
    filters.leadProfileUrl = query.leadId;
  }

  const request: JsonObject = {
    filters,
    limit: Math.min(bounds.limit ?? query.limit ?? PAGE_SIZE, PAGE_SIZE),
  };

  // The page marker is the `nextCursor` of the page before.
  if (bounds.cursor !== undefined) {
    request.cursor = bounds.cursor;
  }

  const from = bounds.from ?? query.since;

  if (from !== undefined) {
    request.from = from;
  }

  if (bounds.to !== undefined) {
    request.to = bounds.to;
  }

  const body = await client.post(ctx, CONVERSATIONS_PATH, request);
  const next = text(field(body, "nextCursor"));

  return {
    conversations: client.items(body, CONVERSATIONS_PATH),
    next:
      field(body, "hasNextPage") === true && next !== null ? next : undefined,
  };
};

/** One page of one campaign's conversations, as HeyReach filters them. */
export const campaignConversations = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery & { readonly campaignId: string }
): Promise<ConversationPage> => {
  const id = numeric(query.campaignId);

  const page = await readPage(client, ctx, query, {
    campaignIds: id === null ? undefined : [id],
    cursor: isString(query.next) && query.next !== "" ? query.next : undefined,
  });

  return {
    items: page.conversations.map((conversation) => ({
      campaignId: query.campaignId,
      conversation,
    })),
    next: page.next,
  };
};

// HeyReach answers 404 for a lead it does not know, which is no campaigns.
const unlessMissing = async (request: Promise<Json>) => {
  try {
    return await request;
  } catch (error) {
    if (OutboundError.is(error) && error.code === "NotFound") {
      return;
    }

    throw error;
  }
};

// The campaigns to walk: a lead's own when the listing is for one lead,
// otherwise every campaign of the workspace. Campaign ids are integers.
const campaignsToWalk = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery
): Promise<string[]> => {
  const leadId = "leadId" in query ? query.leadId : undefined;
  const path = leadId === undefined ? CAMPAIGNS_PATH : LEAD_CAMPAIGNS_PATH;
  const key = leadId === undefined ? "id" : "campaignId";
  const ids: string[] = [];
  let offset: number | undefined = 0;

  while (offset !== undefined) {
    const body: JsonObject = { limit: PAGE_SIZE, offset };

    if (leadId !== undefined) {
      body.profileUrl = leadId;
    }

    // oxlint-disable-next-line no-await-in-loop -- each page's offset follows from the one before.
    const answer = await unlessMissing(client.post(ctx, path, body));

    if (answer === undefined) {
      return ids;
    }

    const envelope = listEnvelope(
      answer,
      offset,
      client.identity.provider,
      path
    );

    ids.push(
      ...envelope.items.flatMap((item) => {
        const id = text(item[key]);

        return id !== null && numeric(id) !== null ? [id] : [];
      })
    );
    offset = envelope.next;
  }

  return ids;
};

// The conversations that belong to any campaign and whose newest message
// falls within the times of a page of the unfiltered listing: every campaign
// conversation that page can hold.
const inCampaigns = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  campaignIds: readonly number[],
  conversations: readonly JsonObject[]
): Promise<Set<string>> => {
  const times = conversations.map((each) => timestamp(each.lastMessageAt));
  const known = times.flatMap((time) => time ?? []).toSorted();
  // A conversation with no time could be anywhere, so then nothing is bounded.
  const bounded = known.length === times.length;
  const ids = new Set<string>();
  let cursor: string | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the one before.
    const page = await readPage(client, ctx, query, {
      campaignIds,
      cursor,
      from: bounded ? known[0] : undefined,
      // The caller's page size is for the records it gets, not this check.
      limit: PAGE_SIZE,
      to: bounded ? known.at(-1) : undefined,
    });

    for (const conversation of page.conversations) {
      const id = text(conversation.id);

      if (id !== null) {
        ids.add(id);
      }
    }

    cursor = page.next;
  } while (cursor !== undefined);

  return ids;
};

// Where a walk stands: every campaign of the workspace, the one being read
// (the inbox once `at` is past the last), and the cursor inside it.
interface Walk {
  readonly campaigns: readonly string[];
  readonly at: number;
  readonly cursor: string | undefined;
}

const walkOf = (next: Json | undefined): Walk | undefined =>
  isJsonObject(next) && Array.isArray(next.campaigns)
    ? {
        at: count(next.at) ?? 0,
        campaigns: list(next.campaigns).flatMap((id) => text(id) ?? []),
        cursor: text(next.cursor) ?? undefined,
      }
    : undefined;

const walkCursor = (walk: Walk): Json => ({
  at: walk.at,
  campaigns: [...walk.campaigns],
  cursor: walk.cursor ?? null,
});

const inboxPage = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  walk: Walk
): Promise<ConversationPage> => {
  const page = await readPage(client, ctx, query, { cursor: walk.cursor });
  const campaignIds = walk.campaigns.flatMap((id) => numeric(id) ?? []);

  const taken =
    campaignIds.length === 0 || page.conversations.length === 0
      ? new Set<string>()
      : await inCampaigns(client, ctx, query, campaignIds, page.conversations);

  return {
    items: page.conversations
      .filter((conversation) => {
        const id = text(conversation.id);

        return id === null || !taken.has(id);
      })
      .map((conversation) => ({ campaignId: null, conversation })),
    next:
      page.next === undefined
        ? undefined
        : walkCursor({ ...walk, cursor: page.next }),
  };
};

// HeyReach can list a campaign it can no longer open: GetAll returns it, but
// a conversation filter naming it, alone or with others, answers 400 "The
// campaign you are trying to open does not exist." (seen live 2026-11-23, on
// a draft that GetById answers 404 for). Such a campaign has no conversation.
const GONE = /campaign you are trying to open does not exist/iu;

// One page of the campaign the walk is at, and where the walk goes next. A
// campaign HeyReach cannot open is left out of the walk, so the inbox's
// filter does not name it either.
const campaignPage = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  walk: Walk,
  campaignId: string
): Promise<{ readonly items: readonly Listed[]; readonly walk: Walk }> => {
  try {
    const page = await campaignConversations(client, ctx, {
      ...query,
      campaignId,
      next: walk.cursor,
    });

    return {
      items: page.items,
      walk:
        page.next === undefined
          ? { ...walk, at: walk.at + 1, cursor: undefined }
          : { ...walk, cursor: text(page.next) ?? undefined },
    };
  } catch (error) {
    if (
      !OutboundError.is(error) ||
      error.status !== 400 ||
      !GONE.test(error.message)
    ) {
      throw error;
    }

    return {
      items: [],
      walk: {
        ...walk,
        campaigns: walk.campaigns.filter((_, index) => index !== walk.at),
        cursor: undefined,
      },
    };
  }
};

/**
 * One page of every campaign's conversations, one campaign after the other,
 * then with `inbox` one page of the conversations that belong to none.
 */
export const everyConversation = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  inbox: boolean
): Promise<ConversationPage> => {
  const walk = walkOf(query.next) ?? {
    at: 0,
    campaigns: await campaignsToWalk(client, ctx, query),
    cursor: undefined,
  };

  const campaignId = walk.campaigns[walk.at];

  if (campaignId === undefined) {
    return inbox
      ? await inboxPage(client, ctx, query, walk)
      : { items: [], next: undefined };
  }

  const after = await campaignPage(client, ctx, query, walk, campaignId);

  return {
    items: after.items,
    next:
      after.walk.at >= after.walk.campaigns.length && !inbox
        ? undefined
        : walkCursor(after.walk),
  };
};
