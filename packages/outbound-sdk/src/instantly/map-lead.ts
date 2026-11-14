// Instantly leads, messages and replies -> normalized entities. Pure
// functions, no I/O. Field names follow the API V2 reference.

import type {
  Lead,
  LeadEngagement,
  LeadStatus,
  Message,
  Reply,
  ReplyCategory,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  stringMap,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { normalizeBody } from "../internal/text.ts";

// The built-in interest statuses, with the names the reference gives them.
const INTEREST = new Map<number, readonly [string, ReplyCategory]>([
  [-4, ["No Show", "negative"]],
  [-3, ["Lost", "negative"]],
  [-2, ["Wrong Person", "negative"]],
  [-1, ["Not Interested", "negative"]],
  [0, ["Out of Office", "ooo"]],
  [1, ["Interested", "positive"]],
  [2, ["Meeting Booked", "positive"]],
  [3, ["Meeting Completed", "positive"]],
  [4, ["Won", "positive"]],
]);

/** A workspace's custom lead labels, by the interest status each one owns. */
export type Labels = ReadonlyMap<number, JsonObject>;

export const NO_LABELS: Labels = new Map();

/** `true` for an interest status that only a custom label can explain. */
export const isCustomInterest = (value: Json | undefined): boolean => {
  const code = count(value);

  return code !== null && !INTEREST.has(code);
};

/** `GET /lead-labels` items, keyed by `interest_status`. */
export const toLabels = (items: readonly JsonObject[]): Labels =>
  new Map(
    items.flatMap((item) => {
      const code = count(item.interest_status);

      return code === null ? [] : [[code, item] as const];
    })
  );

const interest = (value: Json | undefined, labels: Labels): string | null => {
  const code = count(value);

  if (code === null) {
    return null;
  }

  return INTEREST.get(code)?.[0] ?? text(labels.get(code)?.label);
};

// A custom label says only whether it is positive, negative or neutral.
const SENTIMENT = new Map<string, ReplyCategory>([
  ["negative", "negative"],
  ["neutral", "neutral"],
  ["positive", "positive"],
]);

const category = (
  value: Json | undefined,
  labels: Labels
): ReplyCategory | undefined => {
  const code = count(value);

  if (code === null) {
    return undefined;
  }

  return (
    INTEREST.get(code)?.[1] ??
    SENTIMENT.get(text(labels.get(code)?.interest_status_label) ?? "")
  );
};

// -3 is "Skipped", which has no equivalent here.
const LEAD_STATUS = new Map<number, LeadStatus>([
  [-2, "unsubscribed"],
  [-1, "bounced"],
  [1, "active"],
  [2, "paused"],
  [3, "completed"],
]);

// The last step is named by an id (`last_step_id`), not a position, so
// there is no step index to report.
const engagement = (raw: JsonObject): LeadEngagement | null => {
  const read = {
    clicks: count(raw.email_click_count),
    lastContactedAt: timestamp(raw.timestamp_last_contact),
    lastOpenedAt: timestamp(raw.timestamp_last_open),
    lastRepliedAt: timestamp(raw.timestamp_last_reply),
    opens: count(raw.email_open_count),
    replies: count(raw.email_reply_count),
  };

  return Object.values(read).every((value) => value === null)
    ? null
    : { ...read, stepIndex: null };
};

export const toLead = (
  identity: Identity,
  raw: JsonObject,
  labels: Labels = NO_LABELS
): Lead => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  campaignRef: refTo(identity, text(raw.campaign)),
  company: text(raw.company_name),
  createdAt: timestamp(raw.timestamp_created),
  custom: stringMap(raw.payload),
  email: emailAddress(raw.email),
  engagement: engagement(raw),
  firstName: text(raw.first_name),
  interest: interest(raw.lt_interest_status, labels),
  lastName: text(raw.last_name),
  linkedinUrl: null,
  status: LEAD_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
  // Instantly tags mailboxes and campaigns, never leads.
  tags: [],
  title: text(raw.job_title),
});

/** `ue_type`: 1 sent from a campaign, 2 received, 3 sent by hand, 4 scheduled. */
export const SCHEDULED = 4;
const RECEIVED = 2;

const stepIndex = (value: Json | undefined): number | null => {
  const step = text(value);

  return step !== null && /^\d+$/u.test(step) && Number(step) >= 1
    ? Number(step) - 1
    : null;
};

const messageFields = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
) => {
  const body = field(raw.body, "html") ?? field(raw.body, "text");

  return {
    ...recordBase(identity, text(raw.id) ?? "", raw),
    ...normalizeBody(text(body), includeBody),
    campaignRef: refTo(identity, text(raw.campaign_id)),
    channel: "email" as const,
    leadRef: refTo(identity, text(raw.lead_id)),
    senderRef: refTo(identity, emailAddress(raw.eaccount)),
    sentAt: timestamp(raw.timestamp_email) ?? timestamp(raw.timestamp_created),
    stepIndex: stepIndex(raw.step),
    subject: text(raw.subject),
    threadId: text(raw.thread_id),
    variantKey: null,
  };
};

export const isScheduled = (raw: JsonObject): boolean =>
  count(raw.ue_type) === SCHEDULED;

/** `true` when a list response holds an excerpt instead of the whole body. */
export const isTruncated = (raw: JsonObject): boolean =>
  text(raw.body_fallback_reason) !== null;

export const toMessage = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Message => ({
  ...messageFields(identity, raw, includeBody),
  direction: count(raw.ue_type) === RECEIVED ? "in" : "out",
});

const isAuto = (raw: JsonObject): boolean | null => {
  const value = raw.is_auto_reply;

  return flag(value) ?? (count(value) === null ? null : count(value) === 1);
};

export const toReply = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean,
  labels: Labels = NO_LABELS
): Reply => {
  const mapped = category(raw.i_status, labels);

  return {
    ...messageFields(identity, raw, includeBody),
    category: mapped ?? "unknown",
    categorySource: mapped === undefined ? null : "vendor",
    direction: "in",
    isAuto: isAuto(raw),
  };
};
