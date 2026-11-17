// What the EmailBison adapter declares. Every statement here comes from
// EmailBison's public documentation; docs/research/emailbison.md records the
// pages and the date they were read. Nothing has been checked against a live
// account yet, which is why the adapter's maturity is `unverified`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { FieldDeclaration } from "../internal/fields.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

/**
 * The reference's only server. A customer's own instance is the URL they log
 * in with, so most callers pass `baseUrl` or set `EMAILBISON_BASE_URL`.
 */
export const BASE_URL = "https://dedi.emailbison.com";
export const API_KEY_ENV = "EMAILBISON_API_KEY";
export const BASE_URL_ENV = "EMAILBISON_BASE_URL";
export const WORKSPACE_ENV = "EMAILBISON_WORKSPACE_ID";

/** Every list answers 15 records per page, and no page size can be asked for. */
export const PAGE_SIZE = 15;

export const capabilities: CapabilityDeclaration = {
  // GET /api/blacklisted-emails, then GET /api/blacklisted-domains.
  blocklist: true,
  // GET /api/sender-emails/{id}/campaigns.
  "campaigns.bySender": true,
  // GET /api/campaigns/{id} for the caps and tracking, then
  // GET /api/campaigns/{id}/schedule for the sending window.
  "campaigns.settings": true,
  // The status filter takes 11 vendor values and one SDK status covers
  // several of them, so the wrapper filters after fetching.
  "campaigns.status": "client",
  "events.parse": true,
  // The workspace has a webhook secret, but no page says how a delivery is
  // signed. A secret in the URL is what can be checked.
  "events.verify": "secret",
  "leads.byCampaign": true,
  // overall_stats on every lead.
  "leads.engagement": true,
  "leads.get": true,
  "leads.list": true,
  // GET /api/leads/{lead_id} takes an email in place of the id.
  "leads.lookup": true,
  // filters.created_at compares whole days, so the wrapper filters on the
  // creation time after fetching.
  "leads.since": "client",
  // A lead's sent emails, then its replies.
  "leads.timeline": true,
  // GET /api/lead-lists/{id}. No read returns the leads of a list.
  "lists.get": true,
  "lists.list": true,
  "messages.body": "full",
  // GET /api/replies/{id}/conversation-thread: the thread around one reply.
  "messages.byThread": true,
  // Sent campaign emails: GET /api/scheduled-emails?status=sent.
  "messages.list": true,
  "messages.since": "client",
  native: true,
  // `interested` and `automated_reply` on each reply.
  "replies.category": "vendor",
  "replies.list": true,
  // The inbox has no dated filter.
  "replies.since": "client",
  "replies.unread": "server",
  "senders.byCampaign": true,
  "senders.get": true,
  // The sender's connection state and GET /api/warmup/sender-emails/{id}.
  "senders.health": true,
  "senders.list": true,
  "senders.warmup": true,
  // GET /api/campaigns/v1.1/{id}/sequence-steps.
  sequence: true,
  // The line-area series of the workspace or a campaign, and
  // GET /api/campaign-events/stats for one sender.
  "stats.byDay": "exact",
  // A sender's lifetime counts, or its daily events summed over a range.
  "stats.bySender": "exact",
  // sequence_step_stats of POST /api/campaigns/{id}/stats.
  "stats.byStep": "exact",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  tags: true,
  "webhooks.get": true,
  "webhooks.list": true,
  workspaces: true,
};

// What an EmailBison record never carries, and what the adapter works out.
export const fields: FieldDeclaration = {
  // Nothing reports leads by where they are in the sequence.
  campaignProgress: false,
  campaignSettings: {
    endDate: false,
    gapMinutes: false,
    startDate: false,
    stopOnAutoReply: false,
    stopOnReply: false,
  },
  lead: {
    companyLinkedinUrl: false,
    // `interested` on a campaign's lead.
    interest: "derived",
    interestCategory: "derived",
    linkedinUrl: false,
    location: false,
    phone: false,
    recipientMailProvider: false,
    tags: false,
    website: false,
  },
  // A sent email names its step by id, not by place.
  // A message is not marked automatic; a reply is.
  message: {
    isAuto: false,
    isAutoSource: false,
    stepIndex: false,
    // No link to one master inbox conversation is documented.
    url: false,
    variantKey: false,
  },
  metricRow: {
    clicked: false,
    clickedTotal: false,
    completed: false,
    connectionsAccepted: false,
    connectionsSent: false,
    contentHash: false,
    delivered: false,
    inmailsSent: false,
    leads: false,
    opportunities: false,
    opportunityValue: false,
    repliedAutoTotal: false,
    repliedTotal: false,
    repliedAuto: false,
    // No read says which timezone its days are in.
    timezone: false,
  },
  placementTest: false,
  reply: {
    // A fixed rule reads the sender, subject and body when automated_reply is missing.
    leftCompany: "derived",
    stepIndex: false,
    url: false,
    variantKey: false,
  },
  sender: { linkedinUrl: false },
  // Only the main sequence is read, and it has no name.
  sequence: { name: false },
  senderHealth: {
    blacklisted: false,
    checkedAt: false,
    dns: false,
    issues: false,
  },
  tag: { description: false },
  // A webhook is workspace-wide and has no on or off state.
  webhook: { active: false, campaignRefs: false },
};

export const limits: LimitDeclaration = {
  source:
    'https://emailbison.com/blogs/emailbison-vs-salesloft ("up to 3,000 requests per minute"; the API reference at https://dedi.emailbison.com/api/reference documents no limit) and https://emailbison.com/developers (limits are per key; 429 carries retry_after); read 2026-11-15, not confirmed live',
  windows: [{ perMs: 60_000, requests: 3000 }],
};

export const costs = {
  // Emails first, then domains.
  "blocklist.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "campaigns.get": { perPage: 1 },
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // The campaign, then its schedule.
  "campaigns.settings": { perPage: 2 },
  "leads.get": { perPage: 1 },
  // A lookup by address is one request and never walks leads.
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "lists.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // A lead's timeline is its sent emails, then its replies 15 at a time. A
  // thread is one request.
  "messages.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "replies.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  // The sender, then its warmup.
  "senders.health": { perPage: 2 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  // Step rows cost two: the campaign's stats, then its steps.
  // A campaign or its steps add the campaign, for its open tracking.
  stats: { perPage: 1, perPageAtMost: 3 },
  "tags.list": { perPage: 1 },
  "webhooks.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "workspaces.list": { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "Nothing is checked against a live account: no EmailBison workspace or key was available. Mappings follow the API reference read on 2026-11-15, whose response examples are hand-written and often not valid JSON.",
  "Each customer has their own instance: pass baseUrl (or set EMAILBISON_BASE_URL) to the URL you log in with. The default is https://dedi.emailbison.com, the reference's server.",
  "The rate limit is undocumented in the reference. The adapter assumes 3,000 requests per minute per key, from a marketing page, and uses half of it.",
  "Every list returns 15 records per page and cannot be asked for more. Lists that document cursor pagination are read by cursor, so the 1,000-page cap of page numbers does not apply to them.",
  "outbound.raw refuses the workspace reads (they carry webhooks_secret_key) and a mailbox's OAuth access token; normalized records drop webhooks_secret_key from raw.",
  "Campaign status: active, launching and queued are active; stopped and completed are completed; failed, pending deletion and deleted are unknown.",
  "A lead's status is its email verification status: bounced sets bounced, unsubscribed sets unsubscribed. replied is overall_stats.replies above 0. progress comes from lead_campaign_data.status, documented only as stopped (read as paused), so it is unknown on a lead read outside a campaign.",
  "Lead engagement is overall_stats across every campaign: opens and replies as total counts, no clicks and no dates.",
  "interest is Interested when a campaign's lead is marked interested; EmailBison's lead tags are not in any lead payload.",
  "messages.list reads sent campaign emails (GET /api/scheduled-emails?status=sent), whose ids are prefixed scheduled- to keep them apart from replies. A lead's timeline adds its master inbox messages (folder all).",
  "threadId is a reply id: GET /api/replies/{id}/conversation-thread returns the messages before and after it. A message in folder Sent is outgoing.",
  "The unread filter is sent as read=0 or read=1, assuming the API takes booleans the way a Laravel app does; the reference does not say.",
  "Replies are the master inbox's inbox folder. category is positive when interested, ooo when automated_reply, otherwise unknown; only positive and ooo are filtered by EmailBison.",
  "Dated statistics need both dates: a missing end is today (UTC), a missing start 2000-01-01 for totals and 30 days before the end for daily rows. No read says which timezone its days are in.",
  "Workspace and campaign totals: opened is unique opens per contact and openedTotal total opens, replied unique replies per contact, positive interested. No clicks and no automatic-reply count are reported.",
  "A sender's totals without dates are its lifetime counts; with dates they are its daily events summed (derived). Step rows come from sequence_step_stats, one per step and variant.",
  "Sequence variants are steps with variant true, placed under variant_from_step_id or, when that is null, the step with the same order.",
  "Settings: dailyLimit is max_emails_per_day, dailyNewLeads max_new_leads_per_day, one sending window from the campaign schedule. Stop rules, dates and send gaps are not reported.",
  "Sender health: connected from the sender status, warmup from GET /api/warmup/sender-emails/{id} over the last 7 days. No DNS records or block list state are reported.",
  "Webhooks: only EMAIL_SENT, MANUAL_EMAIL_SENT and TAG_ATTACHED have documented payloads. The others are read with the same data keys. Payloads carry no event id, so the id is derived from the event type and the ids in data.",
  "Webhook signatures are not verified: the signing scheme behind webhooks_secret_key is undocumented. Put a secret in the webhook URL.",
  "Block list entries come from two lists: emails first, then domains.",
  "A lead list's size is leads_succeeded.",
  "A message's or reply's url is null: EmailBison documents no link to one master inbox conversation, and no read returns one.",
];
