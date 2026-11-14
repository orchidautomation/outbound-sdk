// Smartlead webhooks -> OutboundEvent. Pure functions, no I/O.
//
// A campaign webhook is one flat JSON object whose `event_type` is an
// uppercase name. Two account-level notices use another envelope
// (`id`, `type`, `data`, `links`, `meta`). Signing follows the Standard
// Webhooks specification and is off until the customer turns it on.

import type { EventFormat, WebhookRequest } from "../internal/adapter.ts";
import { SCHEMA_VERSION } from "../internal/entities.ts";
import type {
  EventType,
  OutboundEvent,
  ReplyCategory,
} from "../internal/entities.ts";
import {
  compactObject,
  count,
  emailAddress,
  field,
  flag,
  isJsonObject,
  isString,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { fromOne } from "../internal/sequence.ts";
import { stableId } from "../internal/sha256.ts";
import { fromBase64, hmacSha256, timingSafeEqual, toBase64 } from "./hmac.ts";
import { campaignStatus, withoutSecrets } from "./map.ts";

// MANUAL_STEP_REACHED has no equivalent and stays unknown.
export const EVENT_TYPES = new Map<string, EventType>([
  ["CAMPAIGN_STATUS_CHANGED", "campaign.status_changed"],
  ["EMAIL_BOUNCE", "message.bounced"],
  ["EMAIL_LINK_CLICK", "message.clicked"],
  ["EMAIL_OPEN", "message.opened"],
  ["EMAIL_REPLY", "reply.received"],
  ["EMAIL_SENT", "message.sent"],
  ["FIRST_EMAIL_SENT", "message.sent"],
  ["LEAD_CATEGORY_UPDATED", "reply.categorized"],
  ["LEAD_UNSUBSCRIBED", "lead.unsubscribed"],
  ["UNTRACKED_REPLIES", "reply.received"],
  ["campaign.bounce_threshold.breached", "campaign.status_changed"],
  ["email.account.disconnected", "sender.status_changed"],
]);

const REPLIES = new Set(["EMAIL_REPLY", "UNTRACKED_REPLIES"]);
const APP_ORIGIN = "https://app.smartlead.ai";
const SECRET_PREFIX = "whsec_";

/** Standard Webhooks: refuse a timestamp more than five minutes off. */
const TOLERANCE_SECONDS = 300;

// The payload names the new category and its sentiment; ids are not read.
const categoryOf = (leadData: Json | undefined): ReplyCategory | undefined => {
  const category = field(leadData, "category");

  if (text(field(category, "name"))?.toLowerCase() === "out of office") {
    return "ooo";
  }

  const sentiment = text(field(category, "sentiment_type"));

  return sentiment === "positive" || sentiment === "negative"
    ? sentiment
    : undefined;
};

const stepIndex = (body: JsonObject): number | null =>
  fromOne(count(body.sequence_number) ?? count(body.current_sequence_number));

const statusChange = (name: string, body: JsonObject): JsonObject =>
  name === "CAMPAIGN_STATUS_CHANGED"
    ? {
        currentStatus: campaignStatus(body.current_status),
        previousStatus: campaignStatus(body.previous_status),
      }
    : {};

const eventData = (name: string, body: JsonObject): JsonObject =>
  compactObject({
    ...statusChange(name, body),
    campaignName: text(body.campaign_name),
    category:
      name === "LEAD_CATEGORY_UPDATED" ? categoryOf(body.lead_data) : undefined,
    categoryName: text(field(body.lead_category, "new_name")),
    isTest: flag(body.is_test),
    leadEmail:
      emailAddress(body.to_email) ??
      emailAddress(body.lead_email) ??
      emailAddress(body.sl_lead_email),
    senderEmail: emailAddress(body.from_email),
    stepIndex: stepIndex(body),
    subject: text(body.subject),
    text: REPLIES.has(name)
      ? (text(field(body.reply_message, "text")) ?? text(body.preview_text))
      : undefined,
    untracked: name === "UNTRACKED_REPLIES" ? true : undefined,
    vendorEvent: name,
  });

const occurredAt = (body: JsonObject): string | null =>
  timestamp(body.event_timestamp) ??
  timestamp(body.time_replied) ??
  timestamp(body.time_sent) ??
  timestamp(body.time_opened) ??
  timestamp(body.time_clicked);

// The sent email is identified by stats_id, a reply by its Message-ID, the
// same ids the message lists use.
const messageId = (name: string, body: JsonObject): string | null =>
  REPLIES.has(name)
    ? (text(field(body.reply_message, "message_id")) ?? text(body.message_id))
    : text(body.stats_id);

const toEvent = (
  identity: Identity,
  body: JsonObject,
  deliveryId: string | null
): OutboundEvent => {
  const name = text(body.event_type) ?? "";
  const at = occurredAt(body);
  const campaignId = text(body.campaign_id);
  const message = messageId(name, body);

  return {
    campaignRef: refTo(identity, campaignId),
    data: eventData(name, body),
    // A signed webhook carries a `webhook-id` that is the same on every
    // retry. Without it the id is built from what identifies the event.
    id:
      deliveryId === null
        ? stableId(
            identity.provider,
            name,
            campaignId,
            text(body.to_email) ?? text(body.lead_email),
            message,
            text(body.current_status),
            at
          )
        : stableId(identity.provider, "webhook-id", deliveryId),
    leadRef: refTo(identity, text(body.sl_email_lead_id) ?? text(body.lead_id)),
    messageRef: refTo(identity, message),
    occurredAt: at,
    provider: identity.provider,
    raw: withoutSecrets(body),
    schemaVersion: SCHEMA_VERSION,
    // The payload names the mailbox by address; a sender's id is a number.
    senderRef: null,
    type: EVENT_TYPES.get(name) ?? "unknown",
    workspaceId: identity.workspaceId,
  };
};

// The account-level notices: `{ id, type, created_at, data, links, meta }`.
const toNotice = (identity: Identity, body: JsonObject): OutboundEvent => {
  const name = text(body.type) ?? "";
  const at = timestamp(body.created_at);

  return {
    campaignRef: refTo(identity, text(field(body.data, "campaign_id"))),
    data: compactObject({
      action: text(field(body.data, "action")),
      reason: text(field(body.data, "reason")),
      senderEmail: emailAddress(field(body.data, "email")),
      vendorEvent: name,
    }),
    id: stableId(identity.provider, name, text(body.id), at),
    leadRef: null,
    messageRef: null,
    occurredAt: at,
    provider: identity.provider,
    raw: withoutSecrets(body),
    schemaVersion: SCHEMA_VERSION,
    senderRef: refTo(identity, text(field(body.data, "account_id"))),
    type: EVENT_TYPES.get(name) ?? "unknown",
    workspaceId: identity.workspaceId,
  };
};

const isNotice = (body: JsonObject): boolean =>
  isString(body.type) &&
  isJsonObject(body.data) &&
  isJsonObject(body.meta) &&
  (text(field(body.links, "app")) ?? "").startsWith(APP_ORIGIN);

// Instantly's `event_type` is lowercase. Smartlead's is uppercase and comes
// with at least one of these fields in every documented payload.
const SMARTLEAD_KEYS = [
  "webhook_id",
  "secret_key",
  "campaign_status",
  "to_email",
];

const detect = (request: WebhookRequest): boolean => {
  const { body } = request;

  if (!isJsonObject(body)) {
    return false;
  }

  return (
    isNotice(body) ||
    (isString(body.event_type) &&
      /^[A-Z]+(?:_[A-Z]+)*$/u.test(body.event_type) &&
      SMARTLEAD_KEYS.some((key) => key in body))
  );
};

/**
 * Standard Webhooks: HMAC-SHA256 of `id.timestamp.body` under the base64
 * part of the `whsec_` secret, compared with each `v1,` signature sent.
 */
const verify = (request: WebhookRequest, secret: string): boolean => {
  const id = request.headers.get("webhook-id");
  const sentAt = request.headers.get("webhook-timestamp");
  const signatures = request.headers.get("webhook-signature");

  if (!id || !sentAt || !signatures || !/^\d+$/u.test(sentAt)) {
    return false;
  }

  if (Math.abs(Date.now() / 1000 - Number(sentAt)) > TOLERANCE_SECONDS) {
    return false;
  }

  const key = fromBase64(
    secret.startsWith(SECRET_PREFIX)
      ? secret.slice(SECRET_PREFIX.length)
      : secret
  );

  if (key === null || key.length === 0) {
    return false;
  }

  const expected = toBase64(
    hmacSha256(
      key,
      new TextEncoder().encode(`${id}.${sentAt}.${request.rawBody}`)
    )
  );

  // Several signatures can be sent, separated by spaces, while a secret rotates.
  return signatures.split(" ").some((signature) => {
    const [version, value] = signature.split(",");

    return (
      version === "v1" &&
      value !== undefined &&
      timingSafeEqual(value, expected)
    );
  });
};

export const smartleadEvents = (provider: string): EventFormat => ({
  detect,
  parse: (request, workspaceId) => {
    const { body } = request;

    if (!isJsonObject(body)) {
      return [];
    }

    const identity = { provider, workspaceId };

    return [
      isNotice(body)
        ? toNotice(identity, body)
        : toEvent(identity, body, request.headers.get("webhook-id")),
    ];
  },
  verify,
});
