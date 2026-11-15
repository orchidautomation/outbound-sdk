// EmailBison webhooks -> OutboundEvent. Pure functions, no I/O.
//
// A delivery is `{ event: { type, name, workspace_id, ... }, data: { ... } }`,
// one event per body. The type is the subscription's event id in upper case
// (`EMAIL_SENT`). Only EMAIL_SENT, MANUAL_EMAIL_SENT and TAG_ATTACHED have
// documented payloads; the others are read with the same `data` keys. No
// payload carries an event id, and no page says how deliveries are signed.

import type { EventFormat, WebhookRequest } from "../internal/adapter.ts";
import { SCHEMA_VERSION } from "../internal/entities.ts";
import type { EventData, OutboundEvent } from "../internal/entities.ts";
import {
  emailAddress,
  field,
  flag,
  fullName,
  isJsonObject,
  isString,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { eventData, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";
import { SENT_PREFIX } from "./map-mail.ts";
import { EVENT_TYPES } from "./map.ts";

const objectAt = (value: Json | undefined, key: string): JsonObject | null => {
  const found = field(value, key);

  return isJsonObject(found) ? found : null;
};

const idAt = (data: JsonObject, key: string): string | null =>
  text(field(data[key], "id"));

// The message an event is about: a reply for the inbox events, the campaign
// email for the rest.
const messageId = (data: JsonObject): string | null => {
  const reply = idAt(data, "reply");

  if (reply !== null) {
    return reply;
  }

  const scheduled = idAt(data, "scheduled_email");

  return scheduled === null ? null : `${SENT_PREFIX}${scheduled}`;
};

const occurredAt = (data: JsonObject): string | null =>
  timestamp(field(data.campaign_event, "created_at")) ??
  timestamp(field(data.reply, "date_received")) ??
  timestamp(field(data.scheduled_email, "sent_at"));

const dataOf = (
  name: string,
  event: JsonObject,
  data: JsonObject
): EventData => {
  const lead = objectAt(data, "lead");
  const reply = objectAt(data, "reply");
  const scheduled = objectAt(data, "scheduled_email");
  const lowered = name.toLowerCase();

  return eventData(
    {
      campaignName: text(field(data.campaign, "name")),
      category: lowered === "lead_interested" ? "positive" : undefined,
      isAuto: flag(field(reply, "automated_reply")) ?? undefined,
      isFirst: lowered === "lead_first_contacted" ? true : undefined,
      leadEmail: emailAddress(field(lead, "email")),
      leadName: fullName(field(lead, "first_name"), field(lead, "last_name")),
      senderEmail: emailAddress(field(data.sender_email, "email")),
      subject:
        text(field(reply, "email_subject")) ??
        text(field(reply, "subject")) ??
        text(field(scheduled, "email_subject")),
      text: text(field(reply, "text_body")),
      untracked: lowered === "untracked_reply_received" ? true : undefined,
      vendorEvent: name,
    },
    {
      tagName: text(data.tag_name),
      taggableId: text(data.taggable_id),
      taggableType: text(data.taggable_type),
      vendorWorkspaceId: text(event.workspace_id),
      vendorWorkspaceName: text(event.workspace_name),
    }
  );
};

const toEvent = (identity: Identity, body: JsonObject): OutboundEvent => {
  const event = objectAt(body, "event") ?? {};
  const data = objectAt(body, "data") ?? {};
  const name = text(event.type) ?? "";
  const message = messageId(data);
  const time = occurredAt(data);

  return {
    campaignRef: refTo(identity, idAt(data, "campaign")),
    data: dataOf(name, event, data),
    // No event id is sent. The type and the ids it names are the same on
    // every delivery of one event.
    id: stableId(
      identity.provider,
      name,
      text(event.workspace_id),
      message,
      idAt(data, "lead"),
      idAt(data, "sender_email"),
      text(data.tag_id),
      text(data.taggable_id),
      text(field(data.campaign_event, "id")),
      time
    ),
    leadRef: refTo(identity, idAt(data, "lead")),
    messageRef: refTo(identity, message),
    occurredAt: time,
    provider: identity.provider,
    raw: body,
    schemaVersion: SCHEMA_VERSION,
    senderRef: refTo(identity, idAt(data, "sender_email")),
    type: EVENT_TYPES.get(name.toLowerCase()) ?? "unknown",
    workspaceId: identity.workspaceId,
  };
};

// `event` is an object with a string `type` beside a `data` object; the
// other vendors send the event name as a string.
const detect = (request: WebhookRequest): boolean =>
  isJsonObject(request.body) &&
  isJsonObject(request.body.event) &&
  isString(request.body.event.type) &&
  isJsonObject(request.body.data);

export const emailbisonEvents = (provider: string): EventFormat => ({
  detect,
  parse: (request, workspaceId) =>
    isJsonObject(request.body)
      ? [toEvent({ provider, workspaceId }, request.body)]
      : [],
});
