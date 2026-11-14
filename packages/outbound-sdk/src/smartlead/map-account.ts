// Smartlead payloads -> the account-level records: campaign settings, sender
// health, lead lists, block list entries, tags and webhook subscriptions.
// Pure functions, no I/O. Field names follow the public documentation; see
// docs/research/smartlead.md.

import type {
  BlockEntry,
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
  isJsonArray,
  isJsonObject,
  isString,
  list,
  parseJson,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { eventTypesOf, recordBase, refTo, refsTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { reputation, withoutSecrets } from "./map.ts";
import { EVENT_TYPES } from "./webhooks.ts";

// The older documentation shows the schedule and the tracking list as JSON
// strings; the current one shows an object and an array.
const parsed = (value: Json | undefined): Json | undefined =>
  isString(value) ? parseJson(value) : value;

const CLOCK = /^(?<hour>\d{1,2}):(?<minute>\d{2})/u;

/** `9:00` and `09:00:00` both become `09:00`. */
const clock = (value: Json | undefined): string | null => {
  const match = CLOCK.exec(text(value) ?? "");
  const hour = match?.groups?.hour;
  const minute = match?.groups?.minute;

  return hour === undefined || minute === undefined
    ? null
    : `${hour.padStart(2, "0")}:${minute}`;
};

const weekdays = (value: Json | undefined): number[] =>
  list(value).flatMap((day) => {
    const number = count(day);

    return number !== null &&
      Number.isInteger(number) &&
      number >= 0 &&
      number <= 6
      ? [number]
      : [];
  });

// `scheduler_cron_value`: one window of `tz`, `days`, `startHour`, `endHour`.
const schedule = (value: Json | undefined): SendingWindow[] => {
  const cron = parsed(value);

  if (!isJsonObject(cron)) {
    return [];
  }

  return [
    {
      days: weekdays(cron.days),
      from: clock(cron.startHour),
      name: null,
      timezone: text(cron.tz),
      to: clock(cron.endHour),
    },
  ];
};

// `track_settings` lists what is NOT tracked. A read shows DONT_EMAIL_OPEN
// and DONT_LINK_CLICK; the write endpoint spells them DONT_TRACK_*. `off` is
// the ending both spellings share.
const tracked = (value: Json | undefined, off: string): boolean | null => {
  const settings = parsed(value);

  return isJsonArray(settings)
    ? !settings.some((setting) => isString(setting) && setting.endsWith(off))
    : null;
};

// Only two values say what a reply does. The others (stop on an open or on a
// click) do not say whether a reply also stops the lead.
const STOP_ON_REPLY = new Map([
  ["NEVER", false],
  ["REPLY_TO_AN_EMAIL", true],
]);

// `ignoreOOOasReply` is documented on the settings update only: when it is
// true an out-of-office reply does not stop the sequence.
const stopOnAutoReply = (
  raw: JsonObject,
  stopOnReply: boolean | null
): boolean | null => {
  const ignored = flag(
    field(raw.out_of_office_detection_settings, "ignoreOOOasReply")
  );

  if (ignored === null) {
    return null;
  }

  return ignored ? false : stopOnReply;
};

/** `GET /campaigns/{id}` -> how the campaign is set up to send. */
export const toSettings = (
  identity: Identity,
  campaignId: string,
  raw: JsonObject
): CampaignSettings => {
  const stopOnReply =
    STOP_ON_REPLY.get(text(raw.stop_lead_settings) ?? "") ?? null;

  return {
    ...recordBase(identity, campaignId, raw),
    campaignRef: refTo(identity, campaignId) ?? "",
    // Named only in the newer example and the settings guide; a mailbox's own
    // daily limit is on the sender.
    dailyLimit: count(raw.sending_limit),
    dailyNewLeads: count(raw.max_leads_per_day),
    endDate: null,
    gapMinutes: count(raw.min_time_btwn_emails),
    plainText: flag(raw.send_as_plain_text),
    schedule: schedule(raw.scheduler_cron_value),
    startDate: timestamp(raw.schedule_start_time)?.slice(0, 10) ?? null,
    stopOnAutoReply: stopOnAutoReply(raw, stopOnReply),
    stopOnReply,
    tracking: {
      clicks: tracked(raw.track_settings, "LINK_CLICK"),
      opens: tracked(raw.track_settings, "EMAIL_OPEN"),
    },
  };
};

const connected = (account: JsonObject): boolean | null => {
  const smtp = flag(account.is_smtp_success);
  const imap = flag(account.is_imap_success);

  if (smtp === false || imap === false) {
    return false;
  }

  return smtp === true && imap === true ? true : null;
};

// The older documentation names the fields sent_count, inbox_count and
// warmup_email_received_count; the newer one total_sent and reputation_score.
const warmupTraffic = (
  stats: Json | undefined,
  details: Json | undefined
): SenderHealth["warmup"] =>
  isJsonObject(stats)
    ? {
        inbox: count(stats.inbox_count),
        received: count(stats.warmup_email_received_count),
        score:
          reputation(stats.reputation_score) ??
          reputation(field(details, "warmup_reputation")),
        sent: count(stats.sent_count) ?? count(stats.total_sent),
        spam: count(stats.spam_count),
      }
    : null;

/**
 * `GET /email-accounts/{id}/` and `GET /email-accounts/{id}/warmup-stats`
 * (the last seven days) -> a mailbox's health. Smartlead's API reports no DNS
 * records and no block list check. `raw` has no SMTP or IMAP password.
 */
export const toHealth = (
  identity: Identity,
  account: JsonObject,
  stats: Json | undefined
): SenderHealth => {
  const id = text(account.id) ?? "";
  const address = emailAddress(account.from_email);

  return {
    ...recordBase(identity, id, {
      account: withoutSecrets(account),
      warmup_stats: stats ?? null,
    }),
    blacklisted: null,
    checkedAt: null,
    connected: connected(account),
    dns: { dkim: null, dmarc: null, mx: null, spf: null },
    domain: address?.split("@")[1] ?? null,
    issues: [
      account.smtp_failure_error,
      account.imap_failure_error,
      field(account.warmup_details, "blocked_reason"),
    ].flatMap((issue) => text(issue) ?? []),
    senderRef: refTo(identity, id) ?? "",
    warmup: warmupTraffic(stats, account.warmup_details),
  };
};

/** One item of `GET /lead-list/`. */
export const toList = (identity: Identity, raw: JsonObject): LeadList => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  createdAt: timestamp(raw.created_at),
  kind: "leads",
  name: text(raw.name) ?? text(raw.id) ?? "",
  size: count(raw.lead_count),
});

/** One item of `GET /leads/get-domain-block-list`: an address or a domain. */
export const toBlockEntry = (
  identity: Identity,
  raw: JsonObject
): BlockEntry => {
  const value = (text(raw.email_or_domain) ?? "").toLowerCase();

  return {
    ...recordBase(identity, text(raw.id) ?? "", raw),
    createdAt: timestamp(raw.created_at),
    kind: value.includes("@") ? "email" : "domain",
    value,
  };
};

/** One item of `GET /email-accounts/tags`. Smartlead tags have no description. */
export const toTag = (identity: Identity, raw: JsonObject): Tag => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  description: null,
  name: text(raw.name) ?? text(raw.id) ?? "",
});

/**
 * One item of `GET /campaigns/{id}/webhooks`. `campaignId` is the campaign
 * that was asked, used when the item does not name its own.
 */
export const toWebhook = (
  identity: Identity,
  campaignId: string,
  raw: JsonObject
): WebhookSubscription => ({
  ...recordBase(identity, text(raw.id) ?? "", withoutSecrets(raw)),
  // Only the newer example carries is_active.
  active: flag(raw.is_active),
  campaignRefs: refsTo(identity, [text(raw.email_campaign_id) ?? campaignId]),
  createdAt: timestamp(raw.created_at),
  eventTypes: eventTypesOf(
    list(raw.event_types).flatMap((event) => text(event) ?? []),
    EVENT_TYPES
  ),
  events: list(raw.event_types).flatMap((event) => text(event) ?? []),
  name: text(raw.name),
  url: text(raw.webhook_url) ?? "",
});
