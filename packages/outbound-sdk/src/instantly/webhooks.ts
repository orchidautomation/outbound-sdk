// Instantly webhooks -> OutboundEvent. Pure functions, no I/O.
//
// Instantly sends one flat JSON object per event and does not sign it. The
// guide and the API reference disagree on two event names, so both spellings
// are accepted.

import type { EventFormat, WebhookRequest } from "../internal/adapter.ts";
import { SCHEMA_VERSION } from "../internal/entities.ts";
import type {
  EventData,
  EventType,
  OutboundEvent,
  ReplyCategory,
} from "../internal/entities.ts";
import {
  emailAddress,
  flag,
  isJsonObject,
  isString,
  text,
  timestamp,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { eventData, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { fromOne, variantKey } from "../internal/sequence.ts";
import { stableId } from "../internal/sha256.ts";

export const EVENT_TYPES = new Map<string, EventType>([
  ["account_error", "sender.status_changed"],
  ["auto_reply_received", "reply.received"],
  ["campaign_completed", "campaign.status_changed"],
  ["email_bounced", "message.bounced"],
  ["email_link_clicked", "message.clicked"],
  ["email_opened", "message.opened"],
  ["email_sent", "message.sent"],
  ["lead_closed", "reply.categorized"],
  ["lead_interested", "reply.categorized"],
  ["lead_meeting_booked", "meeting.booked"],
  ["lead_meeting_completed", "lead.status_changed"],
  ["lead_neutral", "reply.categorized"],
  ["lead_not_interested", "reply.categorized"],
  ["lead_out_of_office", "reply.categorized"],
  ["lead_unsubscribed", "lead.unsubscribed"],
  ["lead_wrong_person", "reply.categorized"],
  ["link_clicked", "message.clicked"],
  ["reply_received", "reply.received"],
]);

const CATEGORIES = new Map<string, ReplyCategory>([
  ["lead_closed", "positive"],
  ["lead_interested", "positive"],
  ["lead_neutral", "neutral"],
  ["lead_not_interested", "negative"],
  ["lead_out_of_office", "ooo"],
  ["lead_wrong_person", "negative"],
]);

// Webhooks number steps and variants from 1.
const dataOf = (name: string, body: JsonObject): EventData => {
  const variant = fromOne(body.variant);

  return eventData({
    campaignName: text(body.campaign_name),
    category: CATEGORIES.get(name),
    isAuto: name === "auto_reply_received" ? true : undefined,
    isFirst: flag(body.is_first),
    leadEmail: emailAddress(body.lead_email),
    stepIndex: fromOne(body.step),
    subject: text(body.reply_subject) ?? text(body.email_subject),
    text: text(body.reply_text) ?? text(body.email_text),
    variantKey: variant === null ? null : variantKey(variant),
    vendorEvent: name,
  });
};

const toEvent = (identity: Identity, body: JsonObject): OutboundEvent => {
  const name = text(body.event_type) ?? "";
  const occurredAt = timestamp(body.timestamp);
  const campaignId = text(body.campaign_id);
  const messageId = text(body.email_id);

  return {
    campaignRef: refTo(identity, campaignId),
    data: dataOf(name, body),
    // Instantly sends no event id, so the id is built from what identifies the event.
    id: stableId(
      identity.provider,
      name,
      campaignId,
      text(body.lead_email),
      messageId,
      occurredAt
    ),
    // A webhook names the lead by address only, so there is no lead ref.
    leadRef: null,
    messageRef: refTo(identity, messageId),
    occurredAt,
    provider: identity.provider,
    raw: body,
    schemaVersion: SCHEMA_VERSION,
    senderRef: refTo(identity, emailAddress(body.email_account)),
    type: EVENT_TYPES.get(name) ?? "unknown",
    workspaceId: identity.workspaceId,
  };
};

const detect = (request: WebhookRequest): boolean =>
  isJsonObject(request.body) &&
  isString(request.body.event_type) &&
  request.body.event_type === request.body.event_type.toLowerCase() &&
  "workspace" in request.body &&
  "timestamp" in request.body;

export const instantlyEvents = (provider: string): EventFormat => ({
  detect,
  parse: (request, workspaceId) =>
    isJsonObject(request.body)
      ? [toEvent({ provider, workspaceId }, request.body)]
      : [],
});
