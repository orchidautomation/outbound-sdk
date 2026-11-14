// HeyReach messages. The API has no message endpoint: messages live inside
// conversations (POST /inbox/GetConversationsV3), so one page of
// conversations is flattened into its messages. One conversation is read
// whole from GET /inbox/GetChatroom/{accountId}/{conversationId}, which needs
// the LinkedIn account as well as the conversation, so a message's `threadId`
// is both: `<accountId>:<conversationId>`.
//
// Checked against a live workspace on 2026-11-14: `sender` is "ME" for the
// account's side and "CORRESPONDENT" for the lead's, messages come oldest
// first, each conversation carried its whole thread (`messages.length`
// matched `totalMessages` in all 257 conversations; the longest had 40), and
// a conversation's `lastMessageAt` was the time of its newest message.

import type {
  Adapter,
  AdapterContext,
  MessageQuery,
  ReplyQuery,
  TimeRange,
} from "../internal/adapter.ts";
import type { Message, Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { field, isString, objects, text, timestamp } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";
import { normalizeBody } from "../internal/text.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { HeyReachClient } from "./client.ts";

export const CONVERSATIONS_PATH = "/inbox/GetConversationsV3";

/** The lead's side of a thread. The account's own side is "ME". */
const FROM_LEAD = "CORRESPONDENT";

interface Scope {
  readonly identity: Identity;
  /** Known only when the listing was filtered to one campaign. */
  readonly campaignId: string | undefined;
  readonly includeBody: boolean;
}

const messageFields = (
  scope: Scope,
  conversation: JsonObject,
  raw: JsonObject
) => {
  const conversationId = text(conversation.id) ?? "";
  const accountId = text(conversation.linkedInAccountId);
  const sentAt = timestamp(raw.createdAt);
  // Messages have no id. The conversation, the time, the side and the text
  // identify one, and stay the same every time the thread is read.
  const id = stableId(conversationId, sentAt, text(raw.sender), text(raw.body));

  return {
    ...recordBase(scope.identity, id, raw),
    ...normalizeBody(text(raw.body), scope.includeBody),
    campaignRef: refTo(scope.identity, scope.campaignId),
    channel: "linkedin" as const,
    // A lead's id is its LinkedIn profile URL, as in leads.get.
    leadRef: refTo(
      scope.identity,
      text(field(conversation.correspondentProfile, "profileUrl"))
    ),
    senderRef: refTo(scope.identity, accountId),
    sentAt,
    stepIndex: null,
    // Only InMails have a subject.
    subject: text(raw.subject),
    // Without the account the conversation cannot be read back, so no thread.
    threadId:
      conversationId === "" || accountId === null
        ? null
        : `${accountId}:${conversationId}`,
    variantKey: null,
  };
};

const isFromLead = (raw: JsonObject): boolean => text(raw.sender) === FROM_LEAD;

const toMessage = (
  scope: Scope,
  conversation: JsonObject,
  raw: JsonObject
): Message => ({
  ...messageFields(scope, conversation, raw),
  direction: isFromLead(raw) ? "in" : "out",
});

const toReply = (
  scope: Scope,
  conversation: JsonObject,
  raw: JsonObject
): Reply => ({
  ...messageFields(scope, conversation, raw),
  // HeyReach's auto-tags describe the lead, not a message, so no category is read.
  category: "unknown",
  categorySource: null,
  direction: "in",
  isAuto: null,
});

interface ConversationPage {
  readonly conversations: JsonObject[];
  readonly next: Json | undefined;
}

const numeric = (id: string): number | null =>
  /^\d+$/u.test(id) ? Number(id) : null;

// The listing bounds conversations by the time of their newest message. Every
// message at or after `since` sits in a conversation whose newest message is
// too, so `since` is sent as `from`. `until` cannot be sent: a conversation
// that went on past it still holds the earlier messages.
const readConversations = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: MessageQuery | ReplyQuery
): Promise<ConversationPage> => {
  const filters: JsonObject = {};

  const campaign =
    query.campaignId === undefined ? null : numeric(query.campaignId);

  if (campaign !== null) {
    filters.campaignIds = [campaign];
  }

  if ("leadId" in query && query.leadId !== undefined) {
    // A looked-up lead's id also names its campaign; the filter takes the URL.
    filters.leadProfileUrl = query.leadId;
  }

  const request: JsonObject = {
    filters,
    limit: Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE),
  };

  // The page marker is the `nextCursor` of the page before.
  if (isString(query.next) && query.next !== "") {
    request.cursor = query.next;
  }

  if (query.since !== undefined) {
    request.from = query.since;
  }

  const body = await client.post(ctx, CONVERSATIONS_PATH, request);
  const next = text(field(body, "nextCursor"));

  return {
    conversations: objects(field(body, "items")),
    next:
      field(body, "hasNextPage") === true && next !== null ? next : undefined,
  };
};

// A conversation is returned whole, so the messages outside the range asked
// for are dropped here. A message with no time is outside every range.
const inRange = (sentAt: string | null, range: TimeRange): boolean => {
  if (range.since === undefined && range.until === undefined) {
    return true;
  }

  if (sentAt === null) {
    return false;
  }

  const time = Date.parse(sentAt);

  return (
    (range.since === undefined || time >= Date.parse(range.since)) &&
    (range.until === undefined || time <= Date.parse(range.until))
  );
};

// A thread id is `<accountId>:<conversationId>`. Conversation ids hold
// letters, digits, "-" and "=", never a colon.
const readThread = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  threadId: string
): Promise<JsonObject> => {
  const [, accountId, conversationId] =
    /^(?<account>\d+):(?<conversation>.+)$/u.exec(threadId) ?? [];

  if (accountId === undefined || conversationId === undefined) {
    throw new OutboundError(
      "Invalid",
      `A HeyReach thread id is "<accountId>:<conversationId>", as a message's threadId gives it, got "${threadId}"`,
      { provider: client.identity.provider }
    );
  }

  const path = `/inbox/GetChatroom/${accountId}/${encodeURIComponent(conversationId)}`;

  return client.object(await client.get(ctx, path), path);
};

type InboxReaders = Pick<Adapter, "listMessages" | "listReplies">;

/** Messages and replies, read from one page of conversations at a time. */
export const inboxReaders = (client: HeyReachClient): InboxReaders => ({
  listMessages: async (query, ctx) => {
    if (query.threadId !== undefined) {
      const conversation = await readThread(client, ctx, query.threadId);

      // A chatroom does not say which campaign it belongs to.
      const scope = {
        campaignId: undefined,
        identity: client.identity,
        includeBody: query.includeBody,
      };

      return {
        items: objects(conversation.messages)
          .map((raw) => toMessage(scope, conversation, raw))
          .filter((message) => inRange(message.sentAt, query)),
      };
    }

    const page = await readConversations(client, ctx, query);

    const scope = {
      campaignId: query.campaignId,
      identity: client.identity,
      includeBody: query.includeBody,
    };

    return {
      items: page.conversations
        .flatMap((conversation) =>
          objects(conversation.messages).map((raw) =>
            toMessage(scope, conversation, raw)
          )
        )
        .filter((message) => inRange(message.sentAt, query)),
      next: page.next,
    };
  },
  listReplies: async (query, ctx) => {
    const page = await readConversations(client, ctx, query);

    const scope = {
      campaignId: query.campaignId,
      identity: client.identity,
      includeBody: query.includeBody,
    };

    return {
      items: page.conversations
        .flatMap((conversation) =>
          objects(conversation.messages).flatMap((raw) =>
            isFromLead(raw) ? [toReply(scope, conversation, raw)] : []
          )
        )
        .filter((reply) => inRange(reply.sentAt, query)),
      next: page.next,
    };
  },
});
