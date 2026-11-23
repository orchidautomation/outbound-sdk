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
// a conversation's `lastMessageAt` was the time of its newest message. Which
// campaign a conversation belongs to comes from how it was listed: see
// conversations.ts.

import type {
  Adapter,
  AdapterContext,
  TimeRange,
} from "../internal/adapter.ts";
import { readReply, ruleSaysAuto } from "../internal/auto-reply.ts";
import type { Message, Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { field, flag, objects, text, timestamp } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";
import { normalizeBody } from "../internal/text.ts";
import type { HeyReachClient } from "./client.ts";
import { campaignConversations, everyConversation } from "./conversations.ts";
import type {
  ConversationPage,
  ConversationQuery,
  Listed,
} from "./conversations.ts";
import { interestCategory } from "./map.ts";

/** The lead's side of a thread. */
export const FROM_LEAD = "CORRESPONDENT";

/** The account's own side of a thread. */
export const FROM_ACCOUNT = "ME";

/**
 * A message's id. Messages have no id: the conversation, the time, the side
 * and the text identify one, and stay the same every time the thread is
 * read. Webhook events name their message by the same id.
 */
export const messageId = (
  conversationId: string,
  sentAt: string | null,
  sender: string | null,
  body: string | null
): string => stableId(conversationId, sentAt, sender, body);

interface Scope {
  readonly identity: Identity;
  /** The campaign the conversation was listed under; null for none. */
  readonly campaignId: string | null;
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

  const id = messageId(
    conversationId,
    sentAt,
    text(raw.sender),
    text(raw.body)
  );

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
    // HeyReach documents no link to a conversation in its Unibox.
    url: null,
    variantKey: null,
  };
};

const isFromLead = (raw: JsonObject): boolean => text(raw.sender) === FROM_LEAD;

// HeyReach flags no message as automatic (its Generic auto-tag covers an
// out-of-office and a neutral answer alike), so the fixed rules read the
// lead's messages: their text, and the subject an InMail has. LinkedIn has
// no sender address and no bounce.
const rulesOf = (raw: JsonObject) => {
  const { leftCompany, rule } = readReply({
    body: text(raw.body),
    from: null,
    subject: text(raw.subject),
  });

  return {
    isAuto: ruleSaysAuto(rule),
    isAutoSource: "rule" as const,
    leftCompany,
    rule,
  };
};

const toMessage = (
  scope: Scope,
  conversation: JsonObject,
  raw: JsonObject
): Message => {
  if (!isFromLead(raw)) {
    return { ...messageFields(scope, conversation, raw), direction: "out" };
  }

  const { isAuto, isAutoSource, rule } = rulesOf(raw);

  return {
    ...messageFields(scope, conversation, raw),
    direction: "in",
    isAuto,
    isAutoSource,
    rule,
  };
};

// HeyReach classifies a lead from its first campaign reply and keeps the
// result on the lead (`autoTags`), with no link to a message. Every reply of
// the conversation gets the lead's newest one, and says so in `categorySource`.
const toReply = (
  scope: Scope,
  conversation: JsonObject,
  raw: JsonObject
): Reply => {
  const category = interestCategory(conversation.correspondentProfile);
  const read = flag(conversation.read);

  return {
    ...messageFields(scope, conversation, raw),
    category: category ?? "unknown",
    categorySource: category === null ? null : "lead",
    direction: "in",
    ...rulesOf(raw),
    // `read` is the conversation's, not one message's.
    unread: read === null ? null : !read,
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

// A campaign filter is applied by HeyReach. Without one every campaign is
// walked, and the conversations in no campaign follow when `inbox` is set.
const conversationsFor = (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: ConversationQuery,
  inbox: boolean
): Promise<ConversationPage> => {
  const { campaignId } = query;

  return campaignId === undefined
    ? everyConversation(client, ctx, query, inbox)
    : campaignConversations(client, ctx, { ...query, campaignId });
};

const scopeOf = (
  client: HeyReachClient,
  listed: Listed,
  includeBody: boolean
): Scope => ({
  campaignId: listed.campaignId,
  identity: client.identity,
  includeBody,
});

/** Messages and replies, read from one page of conversations at a time. */
export const inboxReaders = (client: HeyReachClient): InboxReaders => ({
  listMessages: async (query, ctx) => {
    if (query.threadId !== undefined) {
      const conversation = await readThread(client, ctx, query.threadId);

      // A chatroom does not say which campaign it belongs to.
      const scope = scopeOf(
        client,
        { campaignId: null, conversation },
        query.includeBody
      );

      return {
        items: objects(conversation.messages)
          .map((raw) => toMessage(scope, conversation, raw))
          .filter((message) => inRange(message.sentAt, query)),
      };
    }

    // Every message is kept, whichever campaign its conversation is in.
    const page = await conversationsFor(client, ctx, query, true);

    return {
      items: page.items
        .flatMap((listed) => {
          const scope = scopeOf(client, listed, query.includeBody);

          return objects(listed.conversation.messages).map((raw) =>
            toMessage(scope, listed.conversation, raw)
          );
        })
        .filter((message) => inRange(message.sentAt, query)),
      next: page.next,
    };
  },
  listReplies: async (query, ctx) => {
    // A conversation that belongs to no campaign is not a reply to outreach
    // unless the caller asks for the inbox.
    const page = await conversationsFor(
      client,
      ctx,
      query,
      query.includeInbox === true
    );

    return {
      items: page.items
        .flatMap((listed) => {
          const scope = scopeOf(client, listed, query.includeBody);

          return objects(listed.conversation.messages).flatMap((raw) =>
            isFromLead(raw) ? [toReply(scope, listed.conversation, raw)] : []
          );
        })
        .filter(
          (reply) =>
            inRange(reply.sentAt, query) &&
            // The auto-tag filter of the listing takes HeyReach's own tag
            // names, which the reference does not list, so the category is
            // matched here on the mapped value.
            (query.category === undefined || reply.category === query.category)
        ),
      next: page.next,
    };
  },
});
