// Smartlead activity, message-history and master-inbox payloads -> messages
// and replies. Pure functions, no I/O.

import { detectAutoReply } from "../internal/auto-reply.ts";
import type { Message, Reply, ReplyCategory } from "../internal/entities.ts";
import { replyCategorySchema } from "../internal/entities.ts";
import {
  count,
  field,
  flag,
  isJsonObject,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { fromOne } from "../internal/sequence.ts";
import { stableId } from "../internal/sha256.ts";
import { normalizeBody } from "../internal/text.ts";

/** Category id -> our category, for the ids that mean one. */
export type CategoryMap = ReadonlyMap<string, ReplyCategory>;

const OUT_OF_OFFICE = "out of office";

const SENTIMENT = new Map<string, ReplyCategory>([
  ["negative", "negative"],
  ["positive", "positive"],
]);

const categoryOf = (raw: JsonObject): ReplyCategory | undefined => {
  if (text(raw.name)?.toLowerCase() === OUT_OF_OFFICE) {
    return "ooo";
  }

  const sentiment = SENTIMENT.get(text(raw.sentiment_type) ?? "");

  if (sentiment !== undefined) {
    return sentiment;
  }

  // A null sentiment is neither positive nor negative. A list without the
  // field (the older documented shape) says nothing, so it stays unknown.
  return raw.sentiment_type === null ? "neutral" : undefined;
};

/**
 * `GET /leads/fetch-categories` -> the meaning of each category id. Ids are
 * never hardcoded: an account can rename and add categories.
 */
export const toCategoryMap = (body: Json | undefined): CategoryMap =>
  new Map(
    objects(body).flatMap((raw) => {
      const id = text(raw.id);
      const category = categoryOf(raw);

      return id === null || category === undefined
        ? []
        : [[id, category] as const];
    })
  );

/** The map as it travels in a cursor, and back. */
export const categoriesToJson = (categories: CategoryMap): JsonObject =>
  Object.fromEntries(categories);

export const categoriesFromJson = (value: Json | undefined): CategoryMap =>
  new Map(
    Object.entries(isJsonObject(value) ? value : {}).flatMap(
      ([id, category]) => {
        const parsed = replyCategorySchema.safeParse(category);

        return parsed.success ? [[id, parsed.data] as const] : [];
      }
    )
  );

/** The category ids that mean `category`. */
export const categoryIds = (
  categories: CategoryMap,
  category: ReplyCategory
): number[] =>
  [...categories].flatMap(([id, mapped]) => {
    const number = count(id);

    return mapped === category && number !== null ? [number] : [];
  });

interface MessagePlace {
  readonly campaignId: string | null;
  readonly leadId: string | null;
  readonly senderId?: string | null;
  readonly stepIndex?: number | null;
  readonly threadId?: string | null;
}

interface MessageParts {
  readonly sourceId: string;
  readonly raw: Json;
  readonly body: string | null;
  readonly sentAt: Json | undefined;
  readonly subject: string | null;
}

const messageFields = (
  identity: Identity,
  place: MessagePlace,
  parts: MessageParts,
  includeBody: boolean
) => ({
  ...recordBase(identity, parts.sourceId, parts.raw),
  ...normalizeBody(parts.body, includeBody),
  campaignRef: refTo(identity, place.campaignId),
  channel: "email" as const,
  leadRef: refTo(identity, place.leadId),
  senderRef: refTo(identity, place.senderId),
  sentAt: timestamp(parts.sentAt),
  stepIndex: place.stepIndex ?? null,
  subject: parts.subject,
  threadId: place.threadId ?? null,
  // Smartlead documents no link to one master inbox conversation.
  url: null,
  variantKey: null,
});

// One sent email, and the reply to it when there is one. `thread_replies` is
// documented by name only, so it is not read.
const activityMessages = (
  identity: Identity,
  row: JsonObject,
  activity: JsonObject,
  includeBody: boolean
): Message[] => {
  const place: MessagePlace = {
    campaignId: text(row.campaign_id),
    leadId: text(row.lead_id),
    stepIndex: fromOne(activity.email_seq_number),
    // The lead-in-campaign mapping id is the master inbox's thread id.
    threadId: text(row.email_lead_map_id),
  };

  const sent: Message = {
    ...messageFields(
      identity,
      place,
      {
        body: text(activity.email_body),
        raw: activity,
        sentAt: activity.sent_time,
        sourceId: text(activity.stats_id) ?? "",
        subject: text(activity.subject),
      },
      includeBody
    ),
    direction: "out",
  };

  const reply = activity.reply_details;

  if (!isJsonObject(reply)) {
    return [sent];
  }

  return [
    sent,
    {
      ...messageFields(
        identity,
        place,
        {
          body: text(reply.reply_email_body),
          raw: reply,
          sentAt: reply.time,
          // A reply has no id of its own beyond its Message-ID header.
          sourceId:
            text(reply.message_id) ?? stableId(sent.sourceId, text(reply.time)),
          subject: null,
        },
        includeBody
      ),
      direction: "in",
    },
  ];
};

/** One lead row of `GET /campaigns/all-leads-activities` -> its messages. */
export const toActivityMessages = (
  identity: Identity,
  row: JsonObject,
  includeBody: boolean
): Message[] =>
  objects(row.activities).flatMap((activity) =>
    activityMessages(identity, row, activity, includeBody)
  );

/** One item of a lead's message history: `type` is SENT or REPLY. */
export const toHistoryMessage = (
  identity: Identity,
  place: { readonly campaignId: string; readonly leadId: string },
  item: JsonObject,
  includeBody: boolean
): Message => {
  const isReply = text(item.type) === "REPLY";
  const statsId = text(item.stats_id);
  const messageId = text(item.message_id);

  return {
    ...messageFields(
      identity,
      place,
      {
        body: text(item.email_body),
        raw: item,
        sentAt: item.time,
        // A sent email is identified by its stats_id, as in the activity feed.
        // A reply carries the stats_id of the email it answers.
        sourceId:
          (isReply ? messageId : statsId) ??
          stableId(statsId, messageId, text(item.time)),
        subject: text(item.subject),
      },
      includeBody
    ),
    direction: isReply ? "in" : "out",
  };
};

// A thread's messages are documented in two shapes: `direction` with
// `sent_at` / `received_at` (the newer examples) and `type` SENT / REPLY with
// `time` (the older message history).
const isInbound = (item: JsonObject): boolean =>
  text(item.direction) === "inbound" || text(item.type) === "REPLY";

const threadParts = (
  threadId: string | null,
  item: JsonObject
): MessageParts => {
  const inbound = isInbound(item);
  const time = item.sent_at ?? item.received_at ?? item.time;

  return {
    body: text(item.body) ?? text(item.email_body),
    raw: item,
    sentAt: time,
    sourceId:
      text(item.id) ??
      text(inbound ? item.message_id : item.stats_id) ??
      stableId(threadId, text(item.direction), text(time), text(item.subject)),
    subject: text(item.subject),
  };
};

// The thread names its campaign and mailbox by id. Its lead comes with an
// address only in the documented examples, so the id is read when present.
const threadPlace = (thread: JsonObject): MessagePlace => ({
  campaignId: text(field(thread.campaign, "id")),
  leadId: text(field(thread.lead, "id")) ?? text(thread.lead_id),
  senderId: text(field(thread.email_account, "id")),
  threadId: text(thread.campaign_lead_map_id),
});

/** `GET /master-inbox/{id}` -> every message of the thread, in order. */
export const toThreadMessages = (
  identity: Identity,
  thread: JsonObject,
  includeBody: boolean
): Message[] => {
  const place = threadPlace(thread);

  return objects(thread.message_history).map((item) => ({
    ...messageFields(
      identity,
      place,
      threadParts(place.threadId ?? null, item),
      includeBody
    ),
    direction: isInbound(item) ? "in" : "out",
  }));
};

/**
 * One thread of `POST /master-inbox/inbox-replies` -> its replies: every
 * inbound message of `message_history` when the thread carries one, otherwise
 * the latest reply. The category is the lead's, so every reply of the thread
 * gets the same one.
 */
export const toInboxReplies = (
  identity: Identity,
  item: JsonObject,
  categories: CategoryMap,
  includeBody: boolean
): Reply[] => {
  const last = item.last_message;
  const category = categories.get(text(field(item.category, "id")) ?? "");
  const place = threadPlace(item);
  const history = objects(item.message_history).filter(isInbound);

  const parts: MessageParts[] =
    history.length > 0
      ? history.map((message) => threadParts(place.threadId ?? null, message))
      : [
          {
            body: text(field(last, "body")),
            raw: item,
            sentAt: field(last, "received_at"),
            sourceId: text(field(last, "id")) ?? text(item.id) ?? "",
            subject: text(field(last, "subject")),
          },
        ];

  const read = flag(item.is_read);

  return parts.map((part) => {
    // Smartlead's only automatic-reply signal is the Out Of Office category;
    // otherwise a fixed rule reads the subject and body.
    const verdict = detectAutoReply({
      body: part.body,
      from: null,
      subject: part.subject,
    });

    const vendor = category === "ooo";

    return {
      ...messageFields(identity, place, part, includeBody),
      category: category ?? "unknown",
      // The category is the lead's, not one message's.
      categorySource: category === undefined ? null : "lead",
      direction: "in",
      isAuto: vendor || verdict.isAuto,
      isAutoSource: vendor ? "vendor" : "rule",
      leftCompany: verdict.leftCompany,
      // `is_read` is the thread's.
      unread: read === null ? null : !read,
    };
  });
};
