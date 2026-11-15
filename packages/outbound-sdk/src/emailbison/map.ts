// EmailBison payloads -> normalized entities. Pure functions, no I/O. Field
// names follow the API reference examples (docs/research/emailbison.md).

import type {
  BlockEntry,
  CampaignSettings,
  LeadList,
  SendingWindow,
  Tag,
  WebhookSubscription,
} from "../internal/entities-account.ts";
import type {
  Campaign,
  CampaignStatus,
  EventType,
  Lead,
  LeadProgress,
  MailProvider,
  Sender,
  SenderStatus,
  Workspace,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  isString,
  list,
  objects,
  text,
  timestamp,
  withoutKeys,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { leadStanding } from "../internal/lead-status.ts";
import { eventTypesOf, recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { SECRET_KEYS } from "./client.ts";

// The `status` filter's 11 values. Records show them capitalised.
const CAMPAIGN_STATUSES = new Map<string, CampaignStatus>([
  ["active", "active"],
  ["archived", "archived"],
  ["completed", "completed"],
  ["deleted", "unknown"],
  ["draft", "draft"],
  ["failed", "unknown"],
  ["launching", "active"],
  ["paused", "paused"],
  ["pending deletion", "unknown"],
  ["queued", "active"],
  ["stopped", "completed"],
]);

const lower = (value: Json | undefined): string =>
  (text(value) ?? "").toLowerCase();

/** The names of the `tags` a campaign, sender or lead carries. */
export const tagNames = (value: Json | undefined): string[] =>
  objects(value).flatMap((tag) => text(tag.name) ?? []);

const idOf = (raw: JsonObject): string => text(raw.id) ?? "";

export const toCampaign = (identity: Identity, raw: JsonObject): Campaign => ({
  ...recordBase(identity, idOf(raw), raw),
  channel: "email",
  createdAt: timestamp(raw.created_at),
  name: text(raw.name) ?? idOf(raw),
  status: CAMPAIGN_STATUSES.get(lower(raw.status)) ?? "unknown",
  tags: tagNames(raw.tags),
});

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const clock = (value: Json | undefined): string | null => {
  const time = text(value);

  return time !== null && /^\d{2}:\d{2}$/u.test(time) ? time : null;
};

/** The one window of `GET /api/campaigns/{id}/schedule`. */
export const toWindow = (schedule: JsonObject): SendingWindow => ({
  days: DAYS.flatMap((day, index) => (schedule[day] === true ? [index] : [])),
  from: clock(schedule.start_time),
  name: text(schedule.type),
  timezone: text(schedule.timezone),
  to: clock(schedule.end_time),
});

export const toSettings = (
  identity: Identity,
  campaign: JsonObject,
  schedule: JsonObject | null
): CampaignSettings => ({
  ...recordBase(identity, idOf(campaign), { campaign, schedule }),
  campaignRef: refTo(identity, idOf(campaign)) ?? "",
  dailyLimit: count(campaign.max_emails_per_day),
  dailyNewLeads: count(campaign.max_new_leads_per_day),
  endDate: null,
  gapMinutes: null,
  plainText: flag(campaign.plain_text),
  schedule: schedule === null ? [] : [toWindow(schedule)],
  startDate: null,
  stopOnAutoReply: null,
  stopOnReply: null,
  // Only open tracking is a campaign setting.
  tracking: { clicks: null, opens: flag(campaign.open_tracking) },
});

const SENDER_STATUSES = new Map<string, SenderStatus>([
  ["connected", "active"],
  ["not_connected", "disconnected"],
  ["not connected", "disconnected"],
  ["disconnected", "disconnected"],
]);

export const senderStatus = (raw: JsonObject): SenderStatus =>
  SENDER_STATUSES.get(lower(raw.status)) ?? "unknown";

const mailProvider = (value: Json | undefined): MailProvider | null => {
  const type = lower(value);

  if (type.startsWith("google")) {
    return "google";
  }

  if (type.startsWith("microsoft") || type.startsWith("outlook")) {
    return "microsoft";
  }

  return type === "custom" || type.includes("imap") || type.includes("smtp")
    ? "smtp"
    : null;
};

export const toSender = (identity: Identity, raw: JsonObject): Sender => {
  const enabled = flag(raw.warmup_enabled);

  return {
    ...recordBase(identity, idOf(raw), raw),
    address: emailAddress(raw.email),
    dailyLimit: count(raw.daily_limit),
    kind: "mailbox",
    linkedinUrl: null,
    mailProvider: mailProvider(raw.type),
    name: text(raw.name),
    status: senderStatus(raw),
    tags: tagNames(raw.tags),
    // The sender reads report whether warmup is on; its score is on the
    // warmup reads, which sender health reads.
    warmup: enabled === null ? null : { enabled, score: null },
  };
};

// lead_campaign_data.status. Only `stopped` is documented; the others are
// the campaign-status filter's words.
const PROGRESS = new Map<string, LeadProgress>([
  ["active", "active"],
  ["completed", "completed"],
  ["finished", "completed"],
  ["in_sequence", "active"],
  ["never_contacted", "active"],
  ["not_contacted", "active"],
  ["paused", "paused"],
  ["sequence_finished", "completed"],
  ["sequence_stopped", "paused"],
  ["stopped", "paused"],
]);

const customOf = (value: Json | undefined): Record<string, string> =>
  Object.fromEntries(
    objects(value).flatMap((variable) => {
      const name = text(variable.name);
      const content = variable.value;

      return name === null || content === null || content === undefined
        ? []
        : [[name, isString(content) ? content : String(text(content) ?? "")]];
    })
  );

const engagementOf = (stats: Json | undefined): Lead["engagement"] => {
  if (stats === undefined || stats === null) {
    return null;
  }

  return {
    clicks: null,
    lastContactedAt: null,
    lastOpenedAt: null,
    lastRepliedAt: null,
    opens: count(field(stats, "opens")),
    replies: count(field(stats, "replies")),
    repliedStepIndex: null,
    stepIndex: null,
  };
};

const repliedOf = (stats: Json | undefined): boolean | null => {
  const replies = count(field(stats, "replies"));

  return replies === null ? null : replies > 0;
};

/**
 * A lead. `campaignId` is the campaign it was read through, whose
 * `lead_campaign_data` says where it is in that campaign.
 */
export const toLead = (
  identity: Identity,
  raw: JsonObject,
  campaignId: string | null = null
): Lead => {
  const verification = lower(raw.status);
  const inCampaign = field(raw, "lead_campaign_data");
  const interested = flag(field(inCampaign, "interested"));

  return {
    ...recordBase(identity, idOf(raw), raw),
    ...leadStanding(
      PROGRESS.get(lower(field(inCampaign, "status"))) ?? "unknown",
      {
        bounced: verification === "bounced" ? true : null,
        replied: repliedOf(raw.overall_stats),
        unsubscribed: verification === "unsubscribed" ? true : null,
      }
    ),
    campaignRef: refTo(identity, campaignId),
    company: text(raw.company),
    companyLinkedinUrl: null,
    createdAt: timestamp(raw.created_at),
    custom: customOf(raw.custom_variables),
    email: emailAddress(raw.email),
    engagement: engagementOf(raw.overall_stats),
    firstName: text(raw.first_name),
    interest: interested === true ? "Interested" : null,
    interestCategory: interested === true ? "positive" : null,
    lastName: text(raw.last_name),
    linkedinUrl: null,
    location: null,
    phone: null,
    tags: [],
    title: text(raw.title),
    website: null,
  };
};

export const toLeadList = (identity: Identity, raw: JsonObject): LeadList => ({
  ...recordBase(identity, idOf(raw), raw),
  createdAt: timestamp(raw.created_at),
  kind: "leads",
  name: text(raw.name) ?? idOf(raw),
  size: count(raw.leads_succeeded),
});

/** A block list entry. `kind` is the list it came from. */
export const toBlockEntry = (
  identity: Identity,
  raw: JsonObject,
  kind: "domain" | "email"
): BlockEntry[] => {
  const value = text(kind === "email" ? raw.email : raw.domain)?.toLowerCase();

  return value === undefined
    ? []
    : [
        {
          ...recordBase(identity, `${kind}-${idOf(raw)}`, raw),
          createdAt: timestamp(raw.created_at),
          kind,
          value,
        },
      ];
};

export const toTag = (identity: Identity, raw: JsonObject): Tag[] => {
  const name = text(raw.name);

  return name === null
    ? []
    : [{ ...recordBase(identity, idOf(raw), raw), description: null, name }];
};

// The 23 webhook event ids, lowercase as webhooks and their subscriptions
// name them.
export const EVENT_TYPES = new Map<string, EventType>([
  ["blacklisted_domain_added", "unknown"],
  ["blacklisted_domain_removed", "unknown"],
  ["blacklisted_email_added", "unknown"],
  ["blacklisted_email_removed", "unknown"],
  ["email_account_added", "sender.status_changed"],
  ["email_account_disconnected", "sender.status_changed"],
  ["email_account_reconnected", "sender.status_changed"],
  ["email_account_removed", "sender.status_changed"],
  ["email_bounced", "message.bounced"],
  ["email_opened", "message.opened"],
  ["email_send_failed", "unknown"],
  ["email_sent", "message.sent"],
  ["lead_first_contacted", "message.sent"],
  ["lead_interested", "reply.categorized"],
  ["lead_replied", "reply.received"],
  ["lead_unsubscribed", "lead.unsubscribed"],
  ["manual_email_send_failed", "unknown"],
  ["manual_email_sent", "message.sent"],
  ["tag_attached", "unknown"],
  ["tag_removed", "unknown"],
  ["untracked_reply_received", "reply.received"],
  ["warmup_disabled_causing_bounces", "sender.status_changed"],
  ["warmup_disabled_receiving_bounces", "sender.status_changed"],
]);

export const toWebhook = (
  identity: Identity,
  raw: JsonObject
): WebhookSubscription => {
  const events = list(raw.events).flatMap((name) => text(name) ?? []);

  return {
    ...recordBase(identity, idOf(raw), raw),
    active: null,
    campaignRefs: [],
    createdAt: timestamp(raw.created_at),
    eventTypes: eventTypesOf(
      events.map((name) => name.toLowerCase()),
      EVENT_TYPES
    ),
    events,
    name: text(raw.name),
    url: text(raw.url) ?? "",
  };
};

export const toWorkspace = (
  identity: Identity,
  raw: JsonObject
): Workspace => ({
  // A workspace carries its webhook signing secret, which no record keeps.
  ...recordBase(identity, idOf(raw), withoutKeys(raw, SECRET_KEYS)),
  name: text(raw.name) ?? idOf(raw),
});
