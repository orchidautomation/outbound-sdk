// What the Smartlead adapter declares. Every statement here comes from
// Smartlead's public documentation; docs/research/smartlead.md records the
// pages and the date they were read. Nothing has been checked against a live
// account yet, which is why the adapter's maturity is `unverified`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://server.smartlead.ai/api/v1";
export const API_KEY_ENV = "SMARTLEAD_API_KEY";
export const WORKSPACE_ENV = "SMARTLEAD_WORKSPACE_ID";

/** `GET /campaigns/all-leads-activities` has its own 10 per 60 seconds limit. */
export const ACTIVITIES_LANE = "all-leads-activities";

/** Declared for `raw` callers; the adapter itself does not call these two. */
export const LEAD_STATISTICS_LANE = "leads-statistics";
export const DOMAIN_HEALTH_LANE = "domain-wise-health";

/** Email accounts and a campaign's leads: at most 100 per page. */
export const PAGE_SIZE = 100;

/** The activity feed allows 1,000 lead rows per page; 100 is its default. */
export const ACTIVITIES_PAGE_SIZE = 100;
export const ACTIVITIES_MAX_PAGE_SIZE = 1000;

/** The master inbox returns at most 20 threads per page. */
export const INBOX_PAGE_SIZE = 20;

export const capabilities: CapabilityDeclaration = {
  // GET /campaigns/ has no status filter and returns every campaign at once.
  "campaigns.status": "client",
  "events.parse": true,
  // Standard Webhooks signing, which the customer turns on per webhook.
  "events.verify": "signature",
  "leads.byCampaign": true,
  "leads.get": true,
  // Smartlead has no list of all leads. Without a campaign the adapter walks
  // every campaign's leads; see the caveats.
  "leads.list": true,
  // created_at_gt does not say which created_at it compares, so it is not
  // sent and the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  "messages.body": "full",
  "messages.list": true,
  // event_time_from narrows the feed; the wrapper filters on the send time.
  "messages.since": "client",
  "replies.category": "vendor",
  "replies.list": true,
  // replyTimeBetween narrows the inbox; the wrapper filters on the reply time.
  "replies.since": "client",
  "senders.byCampaign": true,
  "senders.get": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  // GET /analytics/day-wise-overall-stats returns one row per day.
  "stats.byDay": "exact",
  // The per-mailbox endpoint keys rows by address, has no documented filter,
  // paging or completeness, and the per-campaign one documents no response.
  "stats.bySender": false,
  "stats.byStep": "exact",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  workspaces: true,
};

const TEN_PER_MINUTE = [{ perMs: 60_000, requests: 10 }];

export const limits: LimitDeclaration = {
  lanes: {
    [ACTIVITIES_LANE]: TEN_PER_MINUTE,
    [DOMAIN_HEALTH_LANE]: TEN_PER_MINUTE,
    [LEAD_STATISTICS_LANE]: TEN_PER_MINUTE,
  },
  source:
    "https://helpcenter.smartlead.ai/en/articles/68-how-to-get-started-with-the-smartlead-api (200/min shared by every admin key of an account), https://helpcenter.smartlead.ai/en/articles/430-how-client-level-api-keys-work-in-smartlead (60/min per client key) and https://api.smartlead.ai/guides/rate-limits (10 per 60 s on three endpoints); read 2026-11-14, not confirmed live. The key type cannot be detected, so the 60/min client-key limit is used for every key",
  windows: [{ perMs: 60_000, requests: 60 }],
};

export const costs = {
  "campaigns.get": { perPage: 1 },
  // One request returns every campaign; there are no pages.
  "campaigns.list": { perPage: 1 },
  "leads.get": { perPage: 1 },
  // Without a campaign, the first page also reads the campaign list.
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // A lead's timeline costs one request per campaign the lead is in, plus one
  // to find those campaigns.
  "messages.list": { pageSize: ACTIVITIES_PAGE_SIZE, perPage: 1 },
  // The first page of a walk also reads the lead category list.
  "replies.list": { pageSize: INBOX_PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  stats: { perPage: 1 },
  "workspaces.list": { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "Nothing has been checked against a live Smartlead account; every mapping follows the public documentation read on 2026-11-14, and Smartlead's three documentation sources disagree with each other.",
  "The API key travels in the URL as api_key, because Smartlead accepts it nowhere else. The SDK removes it from errors, hooks and logs, but a proxy or server log between you and Smartlead can still record it.",
  "Several endpoints are documented both as a bare payload and wrapped in { ok | success, data }. The adapter accepts both; which one the API returns is not confirmed.",
  "Smartlead has no list of all leads. leads.list without a campaign reads the campaign list and then walks each campaign's leads, so a lead in several campaigns is returned once (from the newest campaign) by listAll, a lead in no campaign is never returned, and the cursor carries the ids of the campaigns still to read. The wrapper also requires leads.list before it allows campaign(id).leads, so the two cannot be declared separately.",
  "A lead's status, campaign and creation time describe the lead inside one campaign. leads.get reads GET /leads/{id}, whose documented example looks illustrative, and returns no campaign.",
  "Lead and campaign status STOPPED (stopped for good) has no equivalent and is mapped to paused; lead status BLOCKED (bounced or on the block list) is mapped to bounced.",
  "Messages come from GET /campaigns/all-leads-activities, which is limited to 10 requests per 60 seconds and has no campaign filter: campaign(id).messages reads the whole feed and keeps that campaign's rows. A page is a page of leads, so it can hold more messages than the limit. Replies listed in thread_replies are not returned because their shape is not documented.",
  "A message names its mailbox by address only, so senderRef is null on messages. A reply from the master inbox names its lead by address and campaign-lead mapping only, so leadRef is null on replies.",
  "A lead's timeline reads GET /leads/{id}/campaigns and then one message history per campaign. Both are documented only in the older documentation, and only the { history, from, to } shape is read.",
  "Replies come from POST /master-inbox/inbox-replies, 20 threads per page. Its documented item looks illustrative, and each item is a thread, so only the latest reply of each thread is returned.",
  "Reply categories are read from GET /leads/fetch-categories once per walk and carried in the cursor. sentiment_type decides positive and negative; a category named Out Of Office is ooo; a category whose sentiment_type is null is neutral; a category list without sentiment_type (the older shape) leaves every other category unknown.",
  "Dated statistics need both a start and an end. A missing end is today (UTC); a missing start is 2000-01-01 for totals, and 30 days before the end for daily rows and for a campaign's dated total, which Smartlead limits to 30 days. Whether the other endpoints cap the range is not documented.",
  "Smartlead reports no delivered count and no automatic-reply count. A campaign's dated total uses non_ooo_reply_count for replied when it is present; lifetime totals use reply_count, which includes out-of-office replies.",
  "Daily rows carry sent, total opens and replies only: Smartlead documents that the daily endpoint always reports 0 bounces, so bounced is null there. A campaign's daily rows come from the same endpoint filtered by campaign_ids.",
  "Step statistics report one open and one click count without saying whether they are unique; they are mapped to openedTotal and clicked. A step with variants returns one row per variant and no step total.",
  "A sender has no status field: it is disconnected when is_smtp_success or is_imap_success is false, active when both are true and unknown otherwise. The warmup score is warmup_reputation, documented both as a number and as a string such as 95%.",
  "Workspaces are Smartlead clients (sub-accounts). A campaign or mailbox with no client belongs to none of them, and a client-level API key may be refused.",
  "Webhook signing is off until the customer turns it on for a webhook; an unsigned webhook fails verify. Signatures older or newer than five minutes are refused, as the Standard Webhooks specification requires. secret_key is removed from the stored payload.",
  "The documented webhook examples omit the lead ids that the field list names, so leadRef is set only when sl_email_lead_id or lead_id is present.",
];
