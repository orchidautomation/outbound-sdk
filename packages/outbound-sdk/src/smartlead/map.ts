// Smartlead payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the public documentation; see docs/research/smartlead.md.

import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadStatus,
  Sender,
  SenderStatus,
  Sequence,
  SequenceStep,
  SequenceVariant,
  Workspace,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  isJsonArray,
  isJsonObject,
  isString,
  objects,
  stringMap,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";

/**
 * Several endpoints are documented both bare and wrapped in
 * `{ ok | success, data }`. Returns the payload either way.
 */
export const unwrap = (body: Json | undefined): Json | undefined =>
  isJsonObject(body) && "data" in body && ("ok" in body || "success" in body)
    ? body.data
    : body;

const SECRET_KEY = /password|secret|token/iu;

/**
 * A copy without any key that holds a credential. Email accounts come back
 * with their SMTP and IMAP passwords, and webhooks with their shared secret.
 */
export const withoutSecrets = (value: Json): Json => {
  if (isJsonArray(value)) {
    return value.map(withoutSecrets);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      SECRET_KEY.test(key) ? [] : [[key, withoutSecrets(entry)] as const]
    )
  );
};

// The union of the values the three documentation sources list. STOPPED is
// "stopped for good", which has no equivalent here.
const CAMPAIGN_STATUS = new Map<string, CampaignStatus>([
  ["ACTIVE", "active"],
  ["ARCHIVED", "archived"],
  ["COMPLETED", "completed"],
  ["DRAFT", "draft"],
  ["DRAFTED", "draft"],
  ["PAUSED", "paused"],
  ["STOPPED", "paused"],
]);

export const campaignStatus = (value: Json | undefined): CampaignStatus =>
  CAMPAIGN_STATUS.get(text(value) ?? "") ?? "unknown";

export const toCampaign = (identity: Identity, raw: JsonObject): Campaign => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  channel: "email",
  createdAt: timestamp(raw.created_at),
  name: text(raw.name) ?? "",
  status: campaignStatus(raw.status),
  // Present only when the request asked for include_tags.
  tags: objects(raw.tags).flatMap((tag) => text(tag.tag_name) ?? []),
});

/** Variants without a label are positional. 0 is "A". */
const positionalKey = (index: number): string =>
  String.fromCodePoint(65 + index);

const toVariant = (raw: JsonObject, index: number): SequenceVariant => {
  const subject = text(raw.subject);
  const body = text(raw.email_body);

  return {
    body,
    contentHash: stableId(subject, body),
    subject,
    variantKey: text(raw.variant_label) ?? positionalKey(index),
  };
};

// The response field list says delayInDays and the write payload says
// delay_in_days; neither documented example shows the field.
const delayDays = (step: JsonObject): number | null =>
  count(field(step.seq_delay_details, "delay_in_days")) ??
  count(field(step.seq_delay_details, "delayInDays"));

const toStep = (step: JsonObject, position: number): SequenceStep => {
  const number = count(step.seq_number);

  const variants = objects(step.sequence_variants).filter(
    (variant) => flag(variant.is_deleted) !== true
  );

  return {
    action: "email",
    branch: null,
    delayDays: delayDays(step),
    index: number === null || number < 1 ? position : number - 1,
    parentIndex: null,
    // With no variants the copy is on the step itself.
    variants: (variants.length === 0 ? [step] : variants).map(toVariant),
  };
};

/** `GET /campaigns/{id}/sequences`: an array of steps, bare or wrapped. */
export const toSequence = (
  identity: Identity,
  campaignId: string,
  body: Json
): Sequence => {
  const steps = unwrap(body);

  return {
    ...recordBase(identity, campaignId, steps ?? null),
    campaignRef: refTo(identity, campaignId) ?? "",
    kind: "main",
    name: null,
    steps: objects(steps)
      .map(toStep)
      .toSorted((left, right) => left.index - right.index)
      .map((step, position, sorted) => ({
        ...step,
        parentIndex: sorted[position - 1]?.index ?? null,
      })),
  };
};

// Smartlead has no status field on a mailbox, only the two connection checks.
const senderStatus = (raw: JsonObject): SenderStatus => {
  const smtp = flag(raw.is_smtp_success);
  const imap = flag(raw.is_imap_success);

  if (smtp === false || imap === false) {
    return "disconnected";
  }

  return smtp === true && imap === true ? "active" : "unknown";
};

// Documented as the number 95 on one page and the string "95%" on another.
const reputation = (value: Json | undefined): number | null =>
  count(isString(value) ? value.replace(/%$/u, "") : value);

const WARMUP_ENABLED = new Map([
  ["ACTIVE", true],
  ["INACTIVE", false],
  ["PAUSED", false],
]);

const warmup = (details: Json | undefined): Sender["warmup"] =>
  isJsonObject(details)
    ? {
        enabled: WARMUP_ENABLED.get(text(details.status) ?? "") ?? null,
        score: reputation(details.warmup_reputation),
      }
    : null;

/** A mailbox. `raw` is the payload without its SMTP and IMAP passwords. */
export const toSender = (identity: Identity, raw: JsonObject): Sender => ({
  ...recordBase(identity, text(raw.id) ?? "", withoutSecrets(raw)),
  address: emailAddress(raw.from_email),
  dailyLimit: count(raw.message_per_day),
  kind: "mailbox",
  linkedinUrl: null,
  name: text(raw.from_name),
  status: senderStatus(raw),
  warmup: warmup(raw.warmup_details),
});

// STARTED is scheduled with nothing sent yet; INPROGRESS has at least one
// email sent. BLOCKED is "bounced or on the block list".
const LEAD_STATUS = new Map<string, LeadStatus>([
  ["BLOCKED", "bounced"],
  ["COMPLETED", "completed"],
  ["INPROGRESS", "active"],
  ["PAUSED", "paused"],
  ["STARTED", "active"],
  ["STOPPED", "paused"],
]);

const leadStatus = (status: Json | undefined, lead: JsonObject): LeadStatus =>
  flag(lead.is_unsubscribed) === true
    ? "unsubscribed"
    : (LEAD_STATUS.get(text(status) ?? "") ?? "unknown");

interface LeadPlace {
  readonly campaignId: string | null;
  readonly createdAt: Json | undefined;
  readonly status: Json | undefined;
  readonly raw: JsonObject;
}

const leadRecord = (
  identity: Identity,
  lead: JsonObject,
  place: LeadPlace
): Lead => ({
  ...recordBase(identity, text(lead.id) ?? "", place.raw),
  campaignRef: refTo(identity, place.campaignId),
  company: text(lead.company_name),
  createdAt: timestamp(place.createdAt),
  custom: stringMap(lead.custom_fields),
  email: emailAddress(lead.email),
  engagement: null,
  firstName: text(lead.first_name),
  interest: null,
  tags: [],
  lastName: text(lead.last_name),
  linkedinUrl: text(lead.linkedin_profile),
  status: leadStatus(place.status, lead),
  // Smartlead has no job title field; a title lives in the custom fields.
  title: null,
});

/**
 * A row of `GET /campaigns/{id}/leads`: the lead inside one campaign. The
 * status and the creation time belong to that campaign membership.
 */
export const toCampaignLead = (
  identity: Identity,
  campaignId: string,
  row: JsonObject
): Lead =>
  leadRecord(identity, isJsonObject(row.lead) ? row.lead : {}, {
    campaignId,
    createdAt: row.created_at,
    raw: row,
    status: row.status,
  });

/** `GET /leads/{id}`: the lead on its own, with no campaign. */
export const toLead = (identity: Identity, raw: JsonObject): Lead =>
  leadRecord(identity, raw, {
    campaignId: null,
    createdAt: raw.created_at,
    raw,
    status: raw.status,
  });

/** A Smartlead client (sub-account). */
export const toWorkspace = (
  identity: Identity,
  raw: JsonObject
): Workspace => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  name: text(raw.name) ?? "",
});
