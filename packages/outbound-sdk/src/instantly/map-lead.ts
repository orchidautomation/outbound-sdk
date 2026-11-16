// Instantly leads, messages and replies -> normalized entities. Pure
// functions, no I/O. Field names follow the API V2 reference.

import { detectAutoReply } from "../internal/auto-reply.ts";
import type {
  Lead,
  LeadEngagement,
  LeadProgress,
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
import { leadStanding } from "../internal/lead-status.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { variantKey } from "../internal/sequence.ts";
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

// 1 active, 2 paused, 3 completed. -1 is bounced and -2 unsubscribed, which
// say what came back and not where the lead is; -3 is "Skipped".
const LEAD_PROGRESS = new Map<number, LeadProgress>([
  [1, "active"],
  [2, "paused"],
  [3, "completed"],
]);

const BOUNCED = -1;
const UNSUBSCRIBED = -2;

const standing = (raw: JsonObject) => {
  const code = count(raw.status);
  const replies = count(raw.email_reply_count);

  return leadStanding(LEAD_PROGRESS.get(code ?? Number.NaN) ?? "unknown", {
    bounced: code === null ? null : code === BOUNCED,
    replied: replies === null ? null : replies > 0,
    unsubscribed: code === null ? null : code === UNSUBSCRIBED,
  });
};

/**
 * A step as Instantly names it on an email and on a lead's last step:
 * `<sequence>_<step>_<variant>`, each counted from 0 (seen live, `0_6_0` for
 * the seventh step's first variant). Any other form is not guessed.
 */
const STEP_ID = /^\d+_(?<step>\d+)_(?<variant>\d+)$/u;

interface StepPosition {
  readonly stepIndex: number | null;
  readonly variantKey: string | null;
}

const stepPosition = (value: Json | undefined): StepPosition => {
  const groups = STEP_ID.exec(text(value) ?? "")?.groups;

  return groups === undefined
    ? { stepIndex: null, variantKey: null }
    : {
        stepIndex: Number(groups.step),
        variantKey: variantKey(Number(groups.variant)),
      };
};

const wholeStep = (value: Json | undefined): number | null => {
  const step = count(value);

  return step !== null && Number.isInteger(step) ? step : null;
};

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
    : {
        ...read,
        // Counted from 0, like every step Instantly reports (seen live).
        repliedStepIndex: wholeStep(raw.email_replied_step),
        // The last step sent, from the lead's status summary.
        stepIndex: stepPosition(
          field(field(raw.status_summary, "lastStep"), "stepID")
        ).stepIndex,
      };
};

export const toLead = (
  identity: Identity,
  raw: JsonObject,
  labels: Labels = NO_LABELS
): Lead => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  ...standing(raw),
  campaignRef: refTo(identity, text(raw.campaign)),
  company: text(raw.company_name),
  // An Instantly lead has no LinkedIn fields of its own.
  companyLinkedinUrl: null,
  createdAt: timestamp(raw.timestamp_created),
  custom: stringMap(raw.payload),
  email: emailAddress(raw.email),
  engagement: engagement(raw),
  firstName: text(raw.first_name),
  interest: interest(raw.lt_interest_status, labels),
  interestCategory: category(raw.lt_interest_status, labels) ?? null,
  lastName: text(raw.last_name),
  linkedinUrl: null,
  location: null,
  phone: text(raw.phone),
  // Instantly tags mailboxes and campaigns, never leads.
  tags: [],
  title: text(raw.job_title),
  website: text(raw.website) ?? text(raw.company_domain),
});

/** `ue_type`: 1 sent from a campaign, 2 received, 3 sent by hand, 4 scheduled. */
export const SCHEDULED = 4;
const RECEIVED = 2;

// An email names its lead by address in `lead`; `lead_id` is documented as
// "if any" and was absent live. The address is the ref, so one person gives
// one leadRef across every campaign. On a received email the sender is the
// lead, so `from_address_email` stands in when `lead` is missing.
const leadOf = (raw: JsonObject): string | null =>
  emailAddress(raw.lead) ??
  (count(raw.ue_type) === RECEIVED
    ? emailAddress(raw.from_address_email)
    : null) ??
  text(raw.lead_id);

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
    leadRef: refTo(identity, leadOf(raw)),
    senderRef: refTo(identity, emailAddress(raw.eaccount)),
    sentAt: timestamp(raw.timestamp_email) ?? timestamp(raw.timestamp_created),
    subject: text(raw.subject),
    threadId: text(raw.thread_id),
    ...stepPosition(raw.step),
  };
};

export const isScheduled = (raw: JsonObject): boolean =>
  count(raw.ue_type) === SCHEDULED;

/** `true` when a list response holds an excerpt instead of the whole body. */
export const isTruncated = (raw: JsonObject): boolean =>
  text(raw.body_fallback_reason) !== null;

// `is_auto_reply` and `is_unread` are documented as 0 or 1.
const oneOrZero = (value: Json | undefined): boolean | null =>
  flag(value) ?? (count(value) === null ? null : count(value) === 1);

/** The body to read for canned phrases, whether or not the caller asked for bodies. */
const rawBody = (raw: JsonObject): string | null =>
  text(field(raw.body, "text")) ??
  text(field(raw.body, "html")) ??
  text(raw.content_preview);

/**
 * `is_auto_reply` is documented but no live email carried it (2026-11-15), and
 * the email list has no filter for it, so a fixed rule decides when it is
 * missing. An Out of Office `i_status` is the vendor saying so.
 */
const autoOf = (raw: JsonObject, mapped: ReplyCategory | undefined) => {
  const verdict = detectAutoReply({
    body: rawBody(raw),
    from: text(raw.from_address_email),
    subject: text(raw.subject),
  });

  const vendor =
    oneOrZero(raw.is_auto_reply) ?? (mapped === "ooo" ? true : null);

  return {
    isAuto: vendor ?? verdict.isAuto,
    isAutoSource: vendor === null ? ("rule" as const) : ("vendor" as const),
    leftCompany: verdict.leftCompany,
  };
};

export const toMessage = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Message => {
  if (count(raw.ue_type) !== RECEIVED) {
    return { ...messageFields(identity, raw, includeBody), direction: "out" };
  }

  const { isAuto, isAutoSource } = autoOf(
    raw,
    category(raw.i_status, NO_LABELS)
  );

  return {
    ...messageFields(identity, raw, includeBody),
    direction: "in",
    isAuto,
    isAutoSource,
  };
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
    ...autoOf(raw, mapped),
    unread: oneOrZero(raw.is_unread),
  };
};
