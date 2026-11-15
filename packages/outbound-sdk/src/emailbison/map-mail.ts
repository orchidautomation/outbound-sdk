// EmailBison emails -> Message and Reply. Pure functions, no I/O.
//
// Two records hold mail. A scheduled email is one campaign email the
// campaign sends (`GET /api/scheduled-emails`, a lead's `sent-emails`). A
// reply is one message in the master inbox, in or out (`GET /api/replies`,
// a thread). Their ids are separate counters, so a sent email's id is
// prefixed `scheduled-`.

import type { Message, Reply, ReplyCategory } from "../internal/entities.ts";
import {
  emailAddress,
  field,
  flag,
  text,
  timestamp,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { normalizeBody } from "../internal/text.ts";

export const SENT_PREFIX = "scheduled-";

const idOf = (raw: JsonObject): string => text(raw.id) ?? "";

// A nested record's id, or the id field beside it.
const linked = (raw: JsonObject, nested: string, key: string): string | null =>
  text(raw[key]) ?? text(field(raw[nested], "id"));

/** A sent campaign email. */
export const toSentMessage = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Message => ({
  ...recordBase(identity, `${SENT_PREFIX}${idOf(raw)}`, raw),
  ...normalizeBody(text(raw.email_body), includeBody),
  campaignRef: refTo(identity, linked(raw, "campaign", "campaign_id")),
  channel: "email",
  direction: "out",
  leadRef: refTo(identity, linked(raw, "lead", "lead_id")),
  senderRef: refTo(identity, linked(raw, "sender_email", "sender_email_id")),
  sentAt: timestamp(raw.sent_at),
  stepIndex: null,
  subject: text(raw.email_subject),
  // A campaign email is not in the master inbox, so it has no thread there.
  threadId: null,
  variantKey: null,
});

/** `true` for a message the workspace sent: the inbox's Sent folder. */
export const isOutgoing = (raw: JsonObject): boolean =>
  (text(raw.folder) ?? "").toLowerCase() === "sent";

const bodyOf = (raw: JsonObject): string | null =>
  text(raw.html_body) ?? text(raw.text_body);

const inboxFields = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
) => ({
  ...recordBase(identity, idOf(raw), raw),
  ...normalizeBody(bodyOf(raw), includeBody),
  campaignRef: refTo(identity, linked(raw, "campaign", "campaign_id")),
  channel: "email" as const,
  leadRef: refTo(identity, linked(raw, "lead", "lead_id")),
  senderRef: refTo(identity, linked(raw, "sender_email", "sender_email_id")),
  sentAt: timestamp(raw.date_received),
  stepIndex: null,
  subject: text(raw.subject) ?? text(raw.email_subject),
  // Any reply in a conversation reads the whole conversation.
  threadId: text(raw.id),
  variantKey: null,
});

/** One message of the master inbox, in or out. */
export const toInboxMessage = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Message => ({
  ...inboxFields(identity, raw, includeBody),
  direction: isOutgoing(raw) ? "out" : "in",
});

const categoryOf = (raw: JsonObject): ReplyCategory => {
  if (raw.interested === true) {
    return "positive";
  }

  return raw.automated_reply === true ? "ooo" : "unknown";
};

export const toReply = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Reply => {
  const category = categoryOf(raw);
  const read = flag(raw.read);

  return {
    ...inboxFields(identity, raw, includeBody),
    category,
    categorySource: category === "unknown" ? null : "vendor",
    direction: "in",
    isAuto: flag(raw.automated_reply),
    unread: read === null ? null : !read,
  };
};

/** The sender a reply came from, lowercased, for event data. */
export const fromAddress = (raw: JsonObject): string | null =>
  emailAddress(raw.from_email_address);
