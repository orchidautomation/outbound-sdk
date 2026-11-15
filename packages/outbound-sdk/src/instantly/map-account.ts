// Instantly's account-level payloads -> normalized records: a campaign's
// settings, a mailbox's health, lead lists, block list entries, custom tags
// and webhooks. Pure functions, no I/O.

import type {
  BlockEntry,
  CampaignProgress,
  CampaignSettings,
  LeadList,
  SenderHealth,
  SendingWindow,
  Tag,
  WebhookSubscription,
} from "../internal/entities-account.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  isJsonObject,
  list,
  objects,
  text,
  timestamp,
  withoutKeys,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { eventTypesOf, recordBase, refTo, refsTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { EVENT_TYPES } from "./webhooks.ts";

const CLOCK = /^\d{2}:\d{2}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const matching = (value: Json | undefined, pattern: RegExp): string | null => {
  const read = text(value);

  return read !== null && pattern.test(read) ? read : null;
};

// `days` is an object keyed "0" to "6" with a boolean each.
const openDays = (value: Json | undefined): number[] =>
  Object.entries(isJsonObject(value) ? value : {})
    .flatMap(([day, open]) =>
      open === true && /^[0-6]$/u.test(day) ? [Number(day)] : []
    )
    .toSorted((left, right) => left - right);

const toWindow = (raw: JsonObject): SendingWindow => ({
  days: openDays(raw.days),
  from: matching(field(raw.timing, "from"), CLOCK),
  name: text(raw.name),
  timezone: text(raw.timezone),
  to: matching(field(raw.timing, "to"), CLOCK),
});

/** The settings are fields of the campaign object itself. */
export const toCampaignSettings = (
  identity: Identity,
  raw: JsonObject
): CampaignSettings => {
  const id = text(raw.id) ?? "";
  const schedule = raw.campaign_schedule;

  return {
    ...recordBase(identity, id, raw),
    campaignRef: refTo(identity, id) ?? "",
    dailyLimit: count(raw.daily_limit),
    dailyNewLeads: count(raw.daily_max_leads),
    endDate: matching(field(schedule, "end_date"), DATE),
    gapMinutes: count(raw.email_gap),
    plainText: flag(raw.text_only),
    schedule: objects(field(schedule, "schedules")).map(toWindow),
    startDate: matching(field(schedule, "start_date"), DATE),
    stopOnAutoReply: flag(raw.stop_on_auto_reply),
    stopOnReply: flag(raw.stop_on_reply),
    tracking: {
      clicks: flag(raw.link_tracking),
      opens: flag(raw.open_tracking),
    },
  };
};

/**
 * One campaign's row of `GET /campaigns/analytics`: `leads_count` is every
 * lead and `completed_count` the leads the campaign was completed for. The
 * report does not split the rest.
 */
export const toCampaignProgress = (
  identity: Identity,
  campaignId: string,
  raw: JsonObject
): CampaignProgress => ({
  ...recordBase(identity, campaignId, raw),
  blocked: null,
  campaignRef: refTo(identity, campaignId) ?? "",
  completed: count(raw.completed_count),
  failed: null,
  inProgress: null,
  leads: count(raw.leads_count),
  notStarted: null,
  stopped: null,
});

/** The three responses a mailbox's health is read from. */
export interface HealthParts {
  /** `GET /accounts/{email}`. */
  readonly account: JsonObject;
  /** `POST /accounts/test/vitals`. */
  readonly vitals: Json;
  /** `POST /accounts/warmup-analytics`. */
  readonly warmup: Json;
}

// The names the reference gives the account and warmup statuses that mean
// something is wrong.
const ACCOUNT_ISSUE = new Map([
  [-3, "Sending Error"],
  [-2, "Soft Bounce Error"],
  [-1, "Connection Error"],
]);

const WARMUP_ISSUE = new Map([
  [-3, "Warmup: Permanent Suspension"],
  [-2, "Warmup: Spam Folder Unknown"],
  [-1, "Warmup: Banned"],
]);

const issues = (account: JsonObject): string[] => {
  const found = [
    ACCOUNT_ISSUE.get(count(account.status) ?? Number.NaN),
    WARMUP_ISSUE.get(count(account.warmup_status) ?? Number.NaN),
    text(field(account.status_message, "response")),
    text(field(account.status_message, "e_message")),
  ].flatMap((issue) => issue ?? []);

  return [...new Set(found)];
};

// Active means Instantly is signed in; a Connection Error means it is not.
// The other statuses (paused, soft bounce, sending error) do not say.
const connected = (account: JsonObject): boolean | null => {
  const status = count(account.status);

  if (status === 1) {
    return true;
  }

  return status === -1 ? false : null;
};

// The DNS test answers per domain, in a list of passes and a list of failures.
const vitalsFor = (
  vitals: Json,
  domain: string | null
): JsonObject | undefined => {
  const entries = [
    ...objects(field(vitals, "success_list")),
    ...objects(field(vitals, "failure_list")),
  ];

  return (
    entries.find((entry) => text(entry.domain)?.toLowerCase() === domain) ??
    (entries.length === 1 ? entries[0] : undefined)
  );
};

// A record the resolver could not check is reported as failing, although
// it may exist. That is unknown, not a failure.
const dnsRecord = (
  entry: JsonObject | undefined,
  key: string
): boolean | null =>
  list(entry?.indeterminate).includes(key) ? null : flag(entry?.[key]);

// `aggregate_data` is keyed by mailbox address.
const warmupFor = (
  warmup: Json,
  address: string | null
): SenderHealth["warmup"] => {
  const totals = field(warmup, "aggregate_data");

  const [, entry] =
    Object.entries(isJsonObject(totals) ? totals : {}).find(
      ([key]) => key.trim().toLowerCase() === address
    ) ?? [];

  return isJsonObject(entry)
    ? {
        inbox: count(entry.landed_inbox),
        received: count(entry.received),
        score: count(entry.health_score),
        sent: count(entry.sent),
        spam: count(entry.landed_spam),
      }
    : null;
};

export const toSenderHealth = (
  identity: Identity,
  id: string,
  parts: HealthParts
): SenderHealth => {
  const address = emailAddress(parts.account.email);
  const sourceId = address ?? id;
  const domain = address?.split("@").at(-1) ?? null;
  const vitals = vitalsFor(parts.vitals, domain);

  return {
    ...recordBase(identity, sourceId, {
      account: parts.account,
      vitals: parts.vitals,
      warmup: parts.warmup,
    }),
    // Instantly reports block lists per inbox placement test, not per mailbox.
    blacklisted: null,
    checkedAt: null,
    connected: connected(parts.account),
    dns: {
      dkim: dnsRecord(vitals, "dkim"),
      dmarc: dnsRecord(vitals, "dmarc"),
      mx: dnsRecord(vitals, "mx"),
      spf: dnsRecord(vitals, "spf"),
    },
    domain,
    issues: issues(parts.account),
    senderRef: refTo(identity, sourceId) ?? "",
    warmup: warmupFor(parts.warmup, address),
  };
};

/**
 * `GET /lead-lists`. The list object carries no count of its leads, so `size`
 * is the `total_leads` of the list's verification statistics when the read
 * fetched them, and `null` on a listing.
 */
export const toLeadList = (
  identity: Identity,
  raw: JsonObject,
  size: number | null = null
): LeadList => {
  const id = text(raw.id) ?? "";

  return {
    ...recordBase(identity, id, raw),
    createdAt: timestamp(raw.timestamp_created),
    kind: "leads",
    name: text(raw.name) ?? id,
    size,
  };
};

const blockKind = (raw: JsonObject): BlockEntry["kind"] => {
  const isDomain = flag(raw.is_domain);

  if (isDomain === null) {
    return "other";
  }

  return isDomain ? "domain" : "email";
};

/**
 * `GET /block-lists-entries`: an address or a whole domain. An entry with no
 * value blocks nothing that can be named, so it is skipped.
 */
export const toBlockEntry = (
  identity: Identity,
  raw: JsonObject
): BlockEntry[] => {
  const value = text(raw.bl_value)?.toLowerCase();

  return value === undefined
    ? []
    : [
        {
          ...recordBase(identity, text(raw.id) ?? "", raw),
          createdAt: timestamp(raw.timestamp_created),
          kind: blockKind(raw),
          value,
        },
      ];
};

/** `GET /custom-tags`: a tag for mailboxes and campaigns. */
export const toTag = (identity: Identity, raw: JsonObject): Tag => {
  const id = text(raw.id) ?? "";

  return {
    ...recordBase(identity, id, raw),
    description: text(raw.description),
    name: text(raw.label) ?? id,
  };
};

// 1 is active; -1 is disabled after delivery failures.
const webhookActive = (raw: JsonObject): boolean | null => {
  const status = count(raw.status);

  if (status === 1) {
    return true;
  }

  return status === -1 ? false : null;
};

// The headers Instantly sends with each delivery can carry a credential, so
// they are left out of the payload kept on the record.
const withoutHeaders = (raw: JsonObject): Json =>
  withoutKeys(raw, /^headers$/iu);

/** `GET /webhooks`: one webhook listens for one event type, or `all_events`. */
export const toWebhook = (
  identity: Identity,
  raw: JsonObject
): WebhookSubscription => ({
  ...recordBase(identity, text(raw.id) ?? "", withoutHeaders(raw)),
  active: webhookActive(raw),
  campaignRefs: refsTo(identity, [text(raw.campaign)]),
  createdAt: timestamp(raw.timestamp_created),
  // `all_events` is every event Instantly sends.
  eventTypes: eventTypesOf(
    text(raw.event_type) === "all_events"
      ? [...EVENT_TYPES.keys()]
      : [text(raw.event_type) ?? ""],
    EVENT_TYPES
  ),
  // A webhook for a custom lead label has no event type.
  events: [text(raw.event_type)].flatMap((event) => event ?? []),
  name: text(raw.name),
  url: text(raw.target_hook_url) ?? "",
});
