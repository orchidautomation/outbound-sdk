// The EmailBison readers for mail: messages, a lead's timeline, a thread and
// the master inbox's replies. One page per call.
//
// - Sent campaign emails: GET /api/scheduled-emails?status=sent.
// - A lead's timeline: GET /api/leads/{id}/sent-emails (one answer), then
//   GET /api/leads/{id}/replies?folder=all page by page.
// - A thread: GET /api/replies/{id}/conversation-thread.
// - Replies: GET /api/replies?folder=inbox.

import type {
  AdapterContext,
  MessageQuery,
  Page,
  ReplyQuery,
} from "../internal/adapter.ts";
import type { Message, Reply, ReplyCategory } from "../internal/entities.ts";
import { field, objects, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import type { QueryValue } from "../internal/url.ts";
import type { EmailBisonClient } from "./client.ts";
import { toInboxMessage, toReply, toSentMessage } from "./map-mail.ts";

const segment = (id: string): string => encodeURIComponent(id);

const byTime = (left: Message, right: Message): number =>
  (left.sentAt ?? "").localeCompare(right.sentAt ?? "");

const thread = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  replyId: string,
  includeBody: boolean
): Promise<Page<Message>> => {
  const path = `/api/replies/${segment(replyId)}/conversation-thread`;
  const data = client.one(await client.get(ctx, path), path);

  const rows: JsonObject[] = [
    ...objects(data.older_messages),
    ...objects([data.current_reply ?? null]),
    ...objects(data.newer_messages),
  ];

  return {
    items: rows
      .map((row) => toInboxMessage(client.identity, row, includeBody))
      .toSorted(byTime),
  };
};

// A lead's timeline reads two lists in turn; `next.phase` says which.
const timeline = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  leadId: string,
  query: MessageQuery
): Promise<Page<Message>> => {
  const { identity } = client;
  const lead = segment(leadId);

  if (field(query.next, "phase") !== "inbox") {
    const path = `/api/leads/${lead}/sent-emails`;

    const sent = client
      .rows(await client.get(ctx, path), path)
      // The list holds a lead's campaign emails; only the sent ones are messages.
      .filter((row) => text(row.status)?.toLowerCase() === "sent")
      .map((row) => toSentMessage(identity, row, query.includeBody));

    return { items: sent, next: { phase: "inbox" } };
  }

  const page = await client.page(
    ctx,
    `/api/leads/${lead}/replies`,
    field(query.next, "page"),
    {
      cursor: true,
      query: {
        campaign_id: query.campaignId,
        folder: "all",
      },
    }
  );

  return {
    items: page.items.map((row) =>
      toInboxMessage(identity, row, query.includeBody)
    ),
    next:
      page.next === undefined ? undefined : { page: page.next, phase: "inbox" },
  };
};

export const listMessages = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  query: MessageQuery
): Promise<Page<Message>> => {
  if (query.threadId !== undefined) {
    return await thread(client, ctx, query.threadId, query.includeBody);
  }

  if (query.leadId !== undefined) {
    return await timeline(client, ctx, query.leadId, query);
  }

  const page = await client.page(ctx, "/api/scheduled-emails", query.next, {
    cursor: true,
    query: { "campaign_ids[]": query.campaignId, status: "sent" },
  });

  return mapPage(page, (row) =>
    toSentMessage(client.identity, row, query.includeBody)
  );
};

// The two categories the inbox filters by; any other is matched after
// mapping.
const STATUS_FILTER = new Map<ReplyCategory, string>([
  ["ooo", "automated_reply"],
  ["positive", "interested"],
]);

const readFlag = (unread: boolean | undefined): number | undefined => {
  if (unread === undefined) {
    return undefined;
  }

  return unread ? 0 : 1;
};

export const listReplies = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  query: ReplyQuery
): Promise<Page<Reply>> => {
  const filters = {
    campaign_id: query.campaignId,
    folder: "inbox",
    // 1 or 0: the reference is generated from a Laravel app, whose boolean
    // rule refuses the words true and false in a query.
    read: readFlag(query.unread),
    status:
      query.category === undefined
        ? undefined
        : STATUS_FILTER.get(query.category),
  } satisfies Record<string, QueryValue>;

  const page = await client.page(ctx, "/api/replies", query.next, {
    cursor: true,
    query: filters,
  });

  const replies = page.items.map((row) =>
    toReply(client.identity, row, query.includeBody)
  );

  return {
    items:
      query.category === undefined
        ? replies
        : replies.filter((reply) => reply.category === query.category),
    next: page.next,
  };
};
