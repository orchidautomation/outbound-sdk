// HeyReach webhooks -> OutboundEvent. Pure functions, no I/O.
//
// Webhook payloads are snake_case (the REST API is camelCase) and are not
// signed. Only `voice_note_received` has a documented payload; the fields read
// here are the ones that payload defines. One webhook carries one event type.
// A message event's messageRef is the ref the REST mapping gives the message,
// from the same fields (docs/research/heyreach.md).

import type { EventFormat, WebhookRequest } from "../internal/adapter.ts";
import { SCHEMA_VERSION } from "../internal/entities.ts";
import type {
  EventData,
  EventType,
  OutboundEvent,
} from "../internal/entities.ts";
import {
  compactObject,
  emailAddress,
  field,
  flag,
  isJsonObject,
  isString,
  list,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { eventData, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";
import { FROM_ACCOUNT, FROM_LEAD, messageId } from "./inbox.ts";

// The 13 documented event types, by the lowercase name the payload carries.
// Follows, post likes and profile views have no normalized type.
export const EVENT_TYPES = new Map<string, EventType>([
  ["campaign_completed", "campaign.status_changed"],
  ["connection_request_accepted", "linkedin.connection_accepted"],
  ["connection_request_sent", "linkedin.connection_sent"],
  ["every_message_reply_received", "linkedin.message_received"],
  ["follow_sent", "unknown"],
  ["inmail_reply_received", "linkedin.message_received"],
  ["inmail_sent", "linkedin.message_sent"],
  ["lead_tag_updated", "lead.status_changed"],
  ["liked_post", "unknown"],
  ["message_reply_received", "linkedin.message_received"],
  ["message_sent", "linkedin.message_sent"],
  ["viewed_profile", "unknown"],
  ["voice_note_received", "linkedin.message_received"],
]);

const recentMessages = (value: Json | undefined): Json[] | undefined => {
  const messages = objects(value).map((message) =>
    compactObject({
      isReply: flag(message.is_reply),
      messageType: text(message.message_type),
      sentAt: timestamp(message.creation_time),
      text: text(message.message),
      transcript: text(field(message.voice_note, "transcript")),
      transcriptStatus: text(field(message.voice_note, "transcript_status")),
    })
  );

  return messages.length === 0 ? undefined : messages;
};

const dataOf = (name: string, body: JsonObject): EventData => {
  const tags = list(field(body.lead, "tags")).filter((tag) => isString(tag));

  return eventData(
    {
      campaignName: text(field(body.campaign, "name")),
      isInmail: flag(body.is_inmail),
      leadEmail: emailAddress(field(body.lead, "email_address")),
      leadName: text(field(body.lead, "full_name")),
      vendorEvent: name,
    },
    {
      conversationId: text(body.conversation_id),
      externalReference: text(body.external_reference),
      leadLinkedinId: text(field(body.lead, "id")),
      recentMessages: recentMessages(body.recent_messages),
      tags: tags.length === 0 ? undefined : tags,
    }
  );
};

/**
 * The ref sync gives the message an event is about: its id hashes the
 * conversation, the send time, the side and the text, which the payload
 * carries as `conversation_id` and `recent_messages`. A received event
 * names the newest reply, a sent one the newest message of the account.
 * `null` for other events, or when the payload lacks one of those fields.
 */
const messageRefOf = (
  identity: Identity,
  type: EventType,
  body: JsonObject
): string | null => {
  const received = type === "linkedin.message_received";

  if (!received && type !== "linkedin.message_sent") {
    return null;
  }

  const conversationId = text(body.conversation_id);

  const message = objects(body.recent_messages).findLast(
    (each) => flag(each.is_reply) === received
  );

  const sentAt = timestamp(message?.creation_time);

  if (conversationId === null || message === undefined || sentAt === null) {
    return null;
  }

  return refTo(
    identity,
    messageId(
      conversationId,
      sentAt,
      received ? FROM_LEAD : FROM_ACCOUNT,
      text(message.message)
    )
  );
};

const toEvent = (identity: Identity, body: JsonObject): OutboundEvent => {
  const name = text(body.event_type) ?? "";
  const occurredAt = timestamp(body.timestamp);
  const correlation = text(body.correlation_id);
  const leadUrl = text(field(body.lead, "profile_url"));
  const type = EVENT_TYPES.get(name.toLowerCase()) ?? "unknown";

  return {
    campaignRef: refTo(identity, text(field(body.campaign, "id"))),
    data: dataOf(name, body),
    // `correlation_id` is the only identifier HeyReach sends. Two event types
    // can describe one reply, so the name is part of the id.
    id:
      correlation === null
        ? stableId(
            identity.provider,
            name,
            text(body.conversation_id),
            leadUrl,
            occurredAt
          )
        : stableId(identity.provider, name, correlation),
    // A lead's id is its profile URL, as in the REST mapping.
    leadRef: refTo(identity, leadUrl),
    messageRef: messageRefOf(identity, type, body),
    occurredAt,
    provider: identity.provider,
    raw: body,
    schemaVersion: SCHEMA_VERSION,
    senderRef: refTo(identity, text(field(body.sender, "id"))),
    type,
    workspaceId: identity.workspaceId,
  };
};

// `correlation_id` beside `event_type` is what sets a HeyReach payload apart;
// Instantly's has `event_type` with `workspace` and no correlation id.
const detect = (request: WebhookRequest): boolean =>
  isJsonObject(request.body) &&
  isString(request.body.event_type) &&
  isString(request.body.correlation_id) &&
  !("workspace" in request.body);

export const heyreachEvents = (provider: string): EventFormat => ({
  detect,
  parse: (request, workspaceId) =>
    isJsonObject(request.body)
      ? [toEvent({ provider, workspaceId }, request.body)]
      : [],
});
