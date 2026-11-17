// Smartlead payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the public documentation; see docs/research/smartlead.md.

import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadProgress,
  MailProvider,
  ReplyCategory,
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
  isJsonObject,
  isString,
  objects,
  stringMap,
  text,
  timestamp,
  withoutKeys,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { leadStanding } from "../internal/lead-status.ts";
import { notNegative } from "../internal/notes.ts";
import type { Note } from "../internal/notes.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { fromOne, toVariant, variantKey } from "../internal/sequence.ts";

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
export const withoutSecrets = (value: Json): Json =>
  withoutKeys(value, SECRET_KEY);

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
  name: text(raw.name) ?? text(raw.id) ?? "",
  status: campaignStatus(raw.status),
  // Present only when the request asked for include_tags.
  tags: objects(raw.tags).flatMap((tag) => text(tag.tag_name) ?? []),
});

// A variant without a label is positional.
const variantOf = (raw: JsonObject, index: number): SequenceVariant =>
  toVariant(
    text(raw.subject),
    text(raw.email_body),
    text(raw.variant_label) ?? variantKey(index)
  );

// The response field list says delayInDays and the write payload says
// delay_in_days; neither documented example shows the field.
const delayDays = (step: JsonObject): number | null =>
  count(field(step.seq_delay_details, "delay_in_days")) ??
  count(field(step.seq_delay_details, "delayInDays"));

const toStep = (
  step: JsonObject,
  position: number,
  note: Note
): SequenceStep => {
  const variants = objects(step.sequence_variants).filter(
    (variant) => flag(variant.is_deleted) !== true
  );

  const index = fromOne(step.seq_number) ?? position;

  return {
    action: "email",
    branch: null,
    delayDays: notNegative(delayDays(step), {
      note,
      unit: "days",
      vendor: "Smartlead",
      what: `Step ${index + 1}'s delay`,
    }),
    index,
    parentIndex: null,
    // With no variants the copy is on the step itself.
    variants: (variants.length === 0 ? [step] : variants).map(variantOf),
  };
};

const toSteps = (steps: Json | undefined, note: Note): SequenceStep[] =>
  objects(steps)
    .map((step, position) => toStep(step, position, note))
    .toSorted((left, right) => left.index - right.index)
    .map((step, position, sorted) => ({
      ...step,
      parentIndex: sorted[position - 1]?.index ?? null,
    }));

/** `GET /campaigns/{id}/sequences`: an array of steps, bare or wrapped. */
export const toSequence = (
  identity: Identity,
  campaignId: string,
  body: Json,
  note: Note
): Sequence => {
  const steps = unwrap(body);

  return {
    ...recordBase(identity, campaignId, steps ?? null),
    campaignRef: refTo(identity, campaignId) ?? "",
    kind: "main",
    name: null,
    steps: toSteps(steps, note),
  };
};

/**
 * A subsequence is a child campaign: `campaign` is its row in the campaign
 * list and `body` is its own `GET /campaigns/{id}/sequences`.
 */
export const toSubsequence = (
  identity: Identity,
  parentId: string,
  campaign: JsonObject,
  body: Json,
  note: Note
): Sequence => {
  const steps = unwrap(body);

  return {
    ...recordBase(identity, text(campaign.id) ?? "", {
      campaign,
      sequences: steps ?? null,
    }),
    campaignRef: refTo(identity, parentId) ?? "",
    kind: "subsequence",
    name: text(campaign.name),
    steps: toSteps(steps, note),
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
export const reputation = (value: Json | undefined): number | null =>
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

// GMAIL, OUTLOOK and SMTP in the current reference; the older one adds ZOHO.
const MAIL_PROVIDER = new Map<string, MailProvider>([
  ["GMAIL", "google"],
  ["OUTLOOK", "microsoft"],
  ["SMTP", "smtp"],
]);

const mailProvider = (value: Json | undefined): MailProvider | null => {
  const type = text(value);

  return type === null ? null : (MAIL_PROVIDER.get(type) ?? "other");
};

/** A mailbox. `raw` is the payload without its SMTP and IMAP passwords. */
export const toSender = (identity: Identity, raw: JsonObject): Sender => ({
  ...recordBase(identity, text(raw.id) ?? "", withoutSecrets(raw)),
  address: emailAddress(raw.from_email),
  dailyLimit: count(raw.message_per_day),
  kind: "mailbox",
  linkedinUrl: null,
  mailProvider: mailProvider(raw.type),
  name: text(raw.from_name),
  status: senderStatus(raw),
  // The mailbox list names a tag `tag_name`; the tag list names it `name`.
  tags: objects(raw.tags).flatMap(
    (tag) => text(tag.tag_name) ?? text(tag.name) ?? []
  ),
  warmup: warmup(raw.warmup_details),
});

// STARTED is scheduled with nothing sent yet; INPROGRESS has at least one
// email sent. BLOCKED is "bounced or on the block list": it says what came
// back, not where the lead is.
const LEAD_PROGRESS = new Map<string, LeadProgress>([
  ["COMPLETED", "completed"],
  ["INPROGRESS", "active"],
  ["PAUSED", "paused"],
  ["STARTED", "active"],
  ["STOPPED", "paused"],
]);

// `email_stats.is_replied` is on the single lead only.
const standing = (status: Json | undefined, lead: JsonObject) => {
  const said = text(status);

  return leadStanding(LEAD_PROGRESS.get(said ?? "") ?? "unknown", {
    bounced: said === null ? null : said === "BLOCKED",
    replied: flag(field(lead.email_stats, "is_replied")),
    unsubscribed: flag(lead.is_unsubscribed),
  });
};

/**
 * The account's lead categories, from `GET /leads/fetch-categories`: each
 * id's name, and what it means for the ids whose sentiment says so.
 */
export interface LeadCategories {
  readonly names: Readonly<Record<string, string>>;
  readonly meanings: ReadonlyMap<string, ReplyCategory>;
}

export const NO_CATEGORIES: LeadCategories = { meanings: new Map(), names: {} };

interface LeadPlace {
  readonly campaignId: string | null;
  readonly createdAt: Json | undefined;
  readonly status: Json | undefined;
  readonly raw: JsonObject;
  /** The lead category's name, when the read can resolve it. */
  readonly interest: string | null;
  /** What the category means, when the category list says. */
  readonly interestCategory: ReplyCategory | null;
  readonly tags: readonly string[];
}

const leadRecord = (
  identity: Identity,
  lead: JsonObject,
  place: LeadPlace
): Lead => ({
  ...recordBase(identity, text(lead.id) ?? "", place.raw),
  ...standing(place.status, lead),
  campaignRef: refTo(identity, place.campaignId),
  company: text(lead.company_name),
  // `linkedin_profile` is the person's; `company_url` is a website.
  companyLinkedinUrl: null,
  createdAt: timestamp(place.createdAt),
  custom: stringMap(lead.custom_fields),
  email: emailAddress(lead.email),
  // Smartlead documents no per-lead counts on a lead read.
  engagement: null,
  firstName: text(lead.first_name),
  interest: place.interest,
  interestCategory: place.interestCategory,
  lastName: text(lead.last_name),
  linkedinUrl: text(lead.linkedin_profile),
  location: text(lead.location),
  meeting: null,
  phone: text(lead.phone_number),
  recipientMailProvider: null,
  tags: [...place.tags],
  // Smartlead has no job title field; a title lives in the custom fields.
  title: null,
  website: text(lead.website) ?? text(lead.company_url),
});

/**
 * A row of `GET /campaigns/{id}/leads`: the lead inside one campaign. The
 * status and the creation time belong to that campaign membership.
 */
export const toCampaignLead = (
  identity: Identity,
  campaignId: string,
  row: JsonObject,
  categories: LeadCategories
): Lead =>
  leadRecord(identity, isJsonObject(row.lead) ? row.lead : {}, {
    campaignId,
    createdAt: row.created_at,
    // The row names its category by id; the name comes from the category list.
    interest: categories.names[text(row.lead_category_id) ?? ""] ?? null,
    interestCategory:
      categories.meanings.get(text(row.lead_category_id) ?? "") ?? null,
    raw: row,
    status: row.status,
    // Tags are read per lead (`GET /crm/leads/tags`), so a listing has none.
    tags: [],
  });

interface FoundPlace {
  readonly campaignId: string;
  /** The campaign's item: of `lead_campaign_data`, or of the lead's campaigns. */
  readonly entry: JsonObject;
  readonly categories: LeadCategories;
}

/**
 * `GET /leads/?email=`: the lead inside one of its campaigns. `raw` has the
 * shape of a campaign's lead row: the campaign's item with the lead under
 * `lead`. Neither read gives the lead's status in the campaign, so the status
 * is unknown unless the lead is unsubscribed, and the creation time is the
 * lead's own.
 */
export const toFoundLead = (
  identity: Identity,
  found: JsonObject,
  place: FoundPlace
): Lead => {
  const { lead_campaign_data: _campaigns, ...lead } = found;

  return leadRecord(identity, lead, {
    campaignId: place.campaignId,
    createdAt: lead.created_at,
    interest:
      place.categories.names[text(place.entry.lead_category_id) ?? ""] ?? null,
    interestCategory:
      place.categories.meanings.get(text(place.entry.lead_category_id) ?? "") ??
      null,
    raw: { ...place.entry, lead },
    status: undefined,
    tags: [],
  });
};

/**
 * `GET /leads/{id}`: the lead on its own, with no campaign. `tags` are the
 * names from `GET /crm/leads/tags?leadId=`, and `categories` says what the
 * lead's `category_id` means.
 */
export const toLead = (
  identity: Identity,
  raw: JsonObject,
  tags: readonly string[],
  categories: LeadCategories = NO_CATEGORIES
): Lead =>
  leadRecord(identity, raw, {
    campaignId: null,
    createdAt: raw.created_at,
    interest:
      text(raw.category_name) ??
      categories.names[text(raw.category_id) ?? ""] ??
      null,
    interestCategory:
      categories.meanings.get(text(raw.category_id) ?? "") ?? null,
    raw,
    status: raw.status,
    tags,
  });

/** A Smartlead client (sub-account). */
export const toWorkspace = (
  identity: Identity,
  raw: JsonObject
): Workspace => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  name: text(raw.name) ?? text(raw.id) ?? "",
});
