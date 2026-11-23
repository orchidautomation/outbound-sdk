// What the Smartlead adapter declares. Every statement here comes from
// Smartlead's public documentation; docs/research/smartlead.md records the
// pages and the date they were read. Nothing has been checked against a live
// account yet, which is why the adapter's maturity is `unverified`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { FieldDeclaration } from "../internal/fields.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://server.smartlead.ai/api/v1";
export const API_KEY_ENV = "SMARTLEAD_API_KEY";
export const WORKSPACE_ENV = "SMARTLEAD_WORKSPACE_ID";

/** `GET /campaigns/all-leads-activities` has its own 10 per 60 seconds limit. */
export const ACTIVITIES_LANE = "all-leads-activities";

/** The native reads of these two endpoints use the lanes; no normalized read does. */
export const LEAD_STATISTICS_LANE = "leads-statistics";
export const DOMAIN_HEALTH_LANE = "domain-wise-health";

/** Email accounts and a campaign's leads: at most 100 per page. */
export const PAGE_SIZE = 100;

/** The activity feed allows 1,000 lead rows per page; 100 is its default. */
export const ACTIVITIES_PAGE_SIZE = 100;
export const ACTIVITIES_MAX_PAGE_SIZE = 1000;

/** The block list allows 1,000 entries per page; 100 is its default. */
export const BLOCKLIST_PAGE_SIZE = 1000;

/** The master inbox returns at most 20 threads per page. */
export const INBOX_PAGE_SIZE = 20;

export const capabilities: CapabilityDeclaration = {
  // GET /leads/get-domain-block-list: addresses and domains.
  blocklist: true,
  // GET /campaigns/{id}: schedule, caps, tracking and stop rules.
  // GET /email-accounts/{id}/?fetch_campaigns=true names the campaign ids.
  // GET /campaigns/ has no name or tag filter and returns every campaign in
  // one response, with its tags under include_tags=true, so the wrapper
  // keeps the matching ones.
  "campaigns.byName": "client",
  "campaigns.bySender": true,
  "campaigns.byTag": "client",
  // GET /campaigns/{id}/analytics carries campaign_lead_stats.
  "campaigns.progress": true,
  "campaigns.settings": true,
  // GET /campaigns/ has no status filter and returns every campaign at once.
  "campaigns.status": "client",
  "events.parse": true,
  // Standard Webhooks signing, which the customer turns on per webhook.
  "events.verify": "signature",
  "leads.byCampaign": true,
  // leads.engagement is left off: the only per-lead counts are in
  // GET /campaigns/{id}/leads-statistics, whose response is documented
  // nowhere, and in a CSV export.
  "leads.get": true,
  // Smartlead has no list of all leads. Without a campaign the adapter walks
  // every campaign's leads; see the caveats.
  "leads.list": true,
  // GET /leads/?email= returns the lead and its campaigns. Nothing finds a
  // lead by its LinkedIn profile, so that filter matches no lead.
  "leads.lookup": true,
  // created_at_gt does not say which created_at it compares, so it is not
  // sent and the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  // SmartDelivery's POST /spam-test/report, on its own host.
  "placementTests.list": true,
  // GET /lead-list/{id}.
  "lists.get": true,
  // GET /lead-list/. lists.leads is left off: no endpoint returns the leads
  // of a lead list.
  "lists.list": true,
  "messages.body": "full",
  // GET /master-inbox/{id}: the id is the lead-in-campaign mapping id.
  "messages.byThread": true,
  "messages.list": true,
  // event_time_from narrows the feed; the wrapper filters on the send time.
  "messages.since": "client",
  // The reads with no normalized form, by name: see native.ts.
  native: true,
  "replies.category": "vendor",
  "replies.list": true,
  // replyTimeBetween narrows the inbox; the wrapper filters on the reply time.
  // A thread carries is_read, and the inbox has no filter for it.
  "replies.unread": "client",
  "replies.since": "client",
  "senders.byCampaign": true,
  "senders.get": true,
  // The mailbox and its warmup statistics; no DNS records are reported.
  "senders.health": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  // Child campaigns of the campaign list, each with its own steps.
  "sequence.subsequences": true,
  // GET /analytics/day-wise-overall-stats returns one row per day.
  "stats.byDay": "exact",
  // GET /analytics/mailbox/name-wise-health-metrics, one row per mailbox
  // address. The per-campaign mailbox endpoint documents no response.
  "stats.bySender": "exact",
  "stats.byStep": "exact",
  // GET /analytics/campaign/overall-stats: a row per campaign, totals only.
  // Partial: it has no clicks and no unsubscribes.
  "stats.allCampaigns": "partial",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  // GET /email-accounts/tags: one tag space for mailboxes, leads and campaigns.
  tags: true,
  // GET /webhook/{webhook_id}.
  "webhooks.get": true,
  // GET /campaigns/{id}/webhooks; there is no list of every webhook.
  "webhooks.list": true,
  workspaces: true,
};

// What a Smartlead record never carries, and what the adapter works out.
export const fields: FieldDeclaration = {
  campaignProgress: { failed: false, skipped: false },
  campaignSettings: { endDate: false },
  lead: {
    companyLinkedinUrl: false,
    engagement: false,
    meeting: false,
    recipientMailProvider: false,
    title: false,
  },
  // A message is not marked automatic; a reply is. No link to one master
  // inbox conversation is documented.
  message: {
    isAuto: false,
    // Read only by the Instantly adapter, whose emails name their lead by address.
    leadEmail: false,
    isAutoSource: false,
    url: false,
    variantKey: false,
  },
  metricRow: {
    completed: false,
    connectionsAccepted: false,
    connectionsSent: false,
    contentHash: false,
    delivered: false,
    inmailsSent: false,
    leads: false,
    // No meetings count in the vendor's analytics.
    meetingsBooked: false,
    opportunities: false,
    opportunityValue: false,
    repliedAutoTotal: false,
    repliedTotal: false,
    // total_reply_count less non_ooo_reply_count.
    repliedAuto: "derived",
  },
  // SmartDelivery's list gives a test's schedule and nothing else about it.
  placementTest: { campaignRef: false, createdAt: false, nextRunAt: false },
  reply: {
    leadEmail: false,
    // The lead's category, not a label on the message.
    category: "derived",
    categorySource: "derived",
    // An Out Of Office category, or a fixed rule on the subject and body.
    isAuto: "derived",
    isAutoSource: "derived",
    leftCompany: "derived",
    // The master inbox does not say which step a reply answers.
    stepIndex: false,
    url: false,
    variantKey: false,
  },
  sender: { linkedinUrl: false },
  senderHealth: { blacklisted: false, checkedAt: false, dns: false },
  tag: { description: false },
};

const TEN_PER_MINUTE = [{ perMs: 60_000, requests: 10 }];

export const limits: LimitDeclaration = {
  lanes: {
    [ACTIVITIES_LANE]: TEN_PER_MINUTE,
    [DOMAIN_HEALTH_LANE]: TEN_PER_MINUTE,
    [LEAD_STATISTICS_LANE]: TEN_PER_MINUTE,
  },
  source:
    "https://helpcenter.smartlead.ai/en/articles/68-how-to-get-started-with-the-smartlead-api (200/min shared by an account's admin keys), https://helpcenter.smartlead.ai/en/articles/430-how-client-level-api-keys-work-in-smartlead (60/min per client key) and https://api.smartlead.ai/guides/rate-limits (10 per 60 s on three endpoints); read 2026-11-14, not confirmed live. The key type cannot be detected, so every key gets the 60/min limit",
  windows: [{ perMs: 60_000, requests: 60 }],
};

export const costs = {
  "blocklist.list": { pageSize: BLOCKLIST_PAGE_SIZE, perPage: 1 },
  "campaigns.get": { perPage: 1 },
  // One request returns every campaign; there are no pages.
  "campaigns.list": { perPage: 1 },
  // The campaign's top-level analytics.
  "campaigns.progress": { perPage: 1 },
  "campaigns.settings": { perPage: 1 },
  // The lead, then its tags, then the category list when the lead has a
  // category.
  "leads.get": { perPage: 2, perWalk: 1 },
  // The first page also reads the lead category list and, without a
  // campaign, the campaign list. A lookup by address is one request, two
  // when a campaign gives a lead category, and never walks leads.
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 2 },
  "lists.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // A lead's timeline costs one request per campaign the lead is in, plus one
  // to find those campaigns. A thread is one request.
  "messages.list": { pageSize: ACTIVITIES_PAGE_SIZE, perPage: 1 },
  // The first page of a walk also reads the lead category list.
  "replies.list": { pageSize: INBOX_PAGE_SIZE, perPage: 1, perWalk: 1 },
  "senders.get": { perPage: 1 },
  // The mailbox, then its warmup statistics.
  "senders.health": { perPage: 2 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  // One subsequence per page; the first page also reads the campaign list.
  "sequence.subsequences": { pageSize: 1, perPage: 1, perWalk: 1 },
  // A mailbox's totals cost two: the mailbox for its address, then the list.
  // Daily rows cost two: the day-wise counts, then the positive replies.
  // The counts (1 or 2 requests), then the tracking settings: the campaign,
  // or for a workspace or mailbox the per-campaign report and the campaign list.
  stats: { perPage: 2, perPageAtMost: 4 },
  "tags.list": { perPage: 1 },
  // One campaign per page; without a campaign, the first page also reads the
  // campaign list.
  "webhooks.list": { perPage: 1, perWalk: 1 },
  "workspaces.list": { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "outbound.raw returns responses unchanged: GET /email-accounts includes SMTP and IMAP passwords, which only normalized records drop.",
  "outbound.native returns each payload as Smartlead sent it. Its catalog leaves out the reads that return secrets: client API keys, a mailbox looked up by address, SmartSenders orders and one-time passwords, and a client's whitelabel credentials.",
  "Native reads of SmartDelivery, SmartProspect, SmartSenders and SmartServers call other hosts with the same key; an account without the product is refused. Their parameters and responses follow the reference alone.",
  "Nothing is checked against a live account; mappings follow the documentation read on 2026-11-14, whose three sources disagree, also on envelopes (bare or { ok | success, data }; both are accepted).",
  "The API key travels in the URL (api_key): the SDK redacts it, but a proxy or server log can record it.",
  "leads.list without a campaign walks every campaign: a lead in no campaign is never returned, and one in several is returned once by listAll.",
  "leads.list({ email }) reads GET /leads/?email=: one record per campaign, all with the lead's id (listAll keeps one), status unknown unless unsubscribed, createdAt the lead's own. Address matching is undocumented; other addresses are dropped.",
  "No endpoint finds a lead by LinkedIn profile: leads.list({ linkedinUrl }) returns nothing and sends no request.",
  "A lead's status, campaign and creation time are per campaign; leads.get returns no campaign and its example looks illustrative.",
  "STOPPED maps to paused. A lead's status BLOCKED, which Smartlead describes as bounced or on the block list, sets bounced and leaves progress unknown. A block-listed lead that was never sent to is therefore counted as bounced too: no documented lead field tells the two apart (email_stats.is_bounced and last_sent_time appear only on a reference page whose shape conflicts with the others), and the block list itself takes entries from bounces. Read from the documentation on 2026-11-16 only. unsubscribed is is_unsubscribed. replied is email_stats.is_replied, which only leads.get carries, so a listed lead's replied is null.",
  "Messages come from GET /campaigns/all-leads-activities (10 requests per 60 s, no campaign filter, pages of leads): campaign(id).messages reads the whole feed, and thread_replies is not read.",
  "senderRef is null on feed and history messages (mailbox named by address). leadRef on replies and thread messages needs lead.id or lead_id on the thread; documented examples show an address only.",
  "threadId is the lead-in-campaign mapping id; history messages have none. GET /master-inbox/{id} is documented without message ids or bodies; older history items are accepted too.",
  "A lead's timeline follows the older documentation's { history, from, to } shape.",
  "Replies come from POST /master-inbox/inbox-replies (illustrative item shape), 20 threads per page: each inbound history message is a reply, or only the latest without a history, and all share the lead's current category.",
  "Reply categories come from GET /leads/fetch-categories: sentiment_type gives positive or negative, null neutral, the name Out Of Office ooo; a list without sentiment_type leaves the rest unknown.",
  "Dated statistics need both dates: a missing end is today (UTC), a missing start 2000-01-01 for totals, or 30 days before the end for daily rows and a campaign's dated total.",
  "No delivered count exists. A campaign's dated total uses non_ooo_reply_count for replied and total_reply_count less non_ooo_reply_count for repliedAuto, which is out-of-office replies only; lifetime reply_count includes out-of-office replies and has no automatic-reply count.",
  "Daily rows have sent, total opens and replies, plus positive replies from a second request (GET /analytics/day-wise-positive-reply-stats); the daily endpoint always reports 0 bounces, so bounced is null.",
  "Step statistics do not say whether opens and clicks are unique (mapped to openedTotal and clickedTotal). A step with variants has a row per variant and no total.",
  "A sender is disconnected when is_smtp_success or is_imap_success is false, active when both are true, else unknown. warmup_reputation may be a number or a string such as 95%.",
  "Workspaces are Smartlead clients; a client-level key may be refused.",
  "Webhook signing is off until turned on per webhook; unsigned webhooks fail verify.",
  "Webhook examples omit lead ids, so leadRef needs sl_email_lead_id or lead_id.",
  "Settings: dailyNewLeads is max_leads_per_day, gapMinutes min_time_btwn_emails, dailyLimit sending_limit (newer example only), startDate the UTC day of schedule_start_time. One sending window, no end date.",
  "stopOnReply is true for REPLY_TO_AN_EMAIL, false for NEVER, else null. stopOnAutoReply needs out_of_office_detection_settings.ignoreOOOasReply, documented on the settings update only.",
  "Subsequences are campaigns whose parent_campaign_id is the campaign, one per page; that GET /campaigns/ lists them is implied, not confirmed. Trigger conditions cannot be read, so branch is null.",
  "Sender health reads the mailbox and its 7-day warmup-stats (both documented shapes). DNS records, block list state and check time are not reported.",
  "A mailbox's statistics are its row, by address, of GET /analytics/mailbox/name-wise-health-metrics (totals only, no filter, undocumented paging): a mailbox it leaves out gets null counts. opened is taken as total opens.",
  "interest is the lead category's name, resolved through GET /leads/fetch-categories; leads.get reads category_name, shown only in an illustrative example.",
  "Lead tags cost a request per lead (GET /crm/leads/tags), so only leads.get fills them. engagement is null: no JSON response documents per-lead counts.",
  "Tags come from GET /email-accounts/tags; whether campaign tags share that list is unconfirmed.",
  "Webhooks are listed per campaign; without one the adapter walks the campaigns and returns each once. User-level or client-level webhooks may appear under none.",
  "Placement tests are read from SmartDelivery (smartdelivery.smartlead.ai) with the same key: an account without the product is refused. The list is documented without pages, and manual is read as a one-time test. A test's results stay native, because SmartDelivery reports them as rates.",
  "Block list entries with an @ are emails, the rest domains.",
  "A message's or reply's url is null: Smartlead documents no link to one master inbox conversation. The app_url and ui_master_inbox_link of its webhooks are documented with the master inbox page only (https://app.smartlead.ai/app/master-inbox), and no read returns a link.",
];
