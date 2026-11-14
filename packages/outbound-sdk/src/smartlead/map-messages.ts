// Smartlead activity, message-history and master-inbox payloads -> messages
// and replies. Pure functions, no I/O.

import type { Message, Reply, ReplyCategory } from "../internal/entities.ts";
import { replyCategorySchema } from "../internal/entities.ts";
import {
  count,
  field,
  isJsonObject,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
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
  variantKey: null,
});

const stepIndex = (value: Json | undefined): number | null => {
  const number = count(value);

  return number === null || number < 1 ? null : number - 1;
};

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
    stepIndex: stepIndex(activity.email_seq_number),
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

/**
 * One thread of `POST /master-inbox/inbox-replies` -> its latest reply. The
 * item names the lead by address and campaign-lead mapping only.
 */
export const toInboxReply = (
  identity: Identity,
  item: JsonObject,
  categories: CategoryMap,
  includeBody: boolean
): Reply => {
  const last = item.last_message;
  const category = categories.get(text(field(item.category, "id")) ?? "");

  return {
    ...messageFields(
      identity,
      {
        campaignId: text(field(item.campaign, "id")),
        leadId: null,
        senderId: text(field(item.email_account, "id")),
        threadId: text(item.campaign_lead_map_id),
      },
      {
        body: text(field(last, "body")),
        raw: item,
        sentAt: field(last, "received_at"),
        sourceId: text(field(last, "id")) ?? text(item.id) ?? "",
        subject: text(field(last, "subject")),
      },
      includeBody
    ),
    category: category ?? "unknown",
    categorySource: category === undefined ? null : "vendor",
    direction: "in",
    // Smartlead's only automatic-reply signal is the Out Of Office category.
    isAuto: category === "ooo" ? true : null,
  };
};
