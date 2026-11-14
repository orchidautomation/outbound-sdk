// What the Instantly adapter declares. Every statement here comes from
// Instantly's API V2 documentation; docs/research/instantly.md records the
// pages and the date they were read. Its reads were then run against one live
// workspace, which is why the adapter's maturity is `beta`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { FieldDeclaration } from "../internal/fields.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://api.instantly.ai/api/v2";
export const API_KEY_ENV = "INSTANTLY_API_KEY";
export const WORKSPACE_ENV = "INSTANTLY_WORKSPACE_ID";

/** `GET /emails` has its own limit, far below the workspace limit. */
export const EMAILS_LANE = "emails";
export const PAGE_SIZE = 100;

/** Three native reads have a limit of their own; each is a lane. */
export const LABEL_PREDICTION_LANE = "labelPrediction";
export const LOCAL_FILTERS_LANE = "localBusinessFilters";
export const LOCAL_SEARCH_LANE = "localBusinessSearch";

const DAY_MS = 86_400_000;

/** How many pages of tag assignments are read for one page of campaigns. */
export const TAG_PAGES = 10;

export const capabilities: CapabilityDeclaration = {
  blocklist: true,
  // GET /account-campaign-mappings/{email}.
  "campaigns.bySender": true,
  "campaigns.settings": true,
  // Draft and completed are filtered by Instantly. Active and paused each
  // cover several Instantly statuses, so the adapter matches those itself.
  "campaigns.status": "server",
  "events.parse": true,
  // Instantly does not sign webhooks. Use a secret header or URL path.
  "events.verify": "secret",
  "leads.byCampaign": true,
  "leads.engagement": true,
  "leads.get": true,
  "leads.list": true,
  // By email only, with the `contacts` filter of POST /leads/list. A lead has
  // no LinkedIn profile, so a lookup by profile finds nothing.
  "leads.lookup": true,
  // POST /leads/list has no date filter, so the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  // GET /lead-lists/{id}, then its verification-stats for the size.
  "lists.get": true,
  "lists.leads": true,
  "lists.list": true,
  // A list response can cut a large body short (`body_fallback_reason`); the
  // adapter then reads that email on its own, where the body is whole.
  "messages.body": "full",
  "messages.byThread": true,
  "messages.list": true,
  "messages.since": "server",
  // Every read endpoint with no normalized form is in the native catalog.
  native: true,
  "replies.category": "vendor",
  "replies.list": true,
  // GET /emails takes is_unread.
  "replies.unread": "server",
  "replies.since": "server",
  "senders.byCampaign": true,
  "senders.get": true,
  "senders.health": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  "sequence.subsequences": true,
  "stats.byDay": "exact",
  // Per-mailbox numbers exist by day only; a total is summed by the adapter.
  "stats.bySender": "derived",
  "stats.byStep": "exact",
  // GET /campaigns/analytics with no id: a row per campaign, totals only.
  "stats.allCampaigns": "exact",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  tags: true,
  // GET /webhooks/{id}.
  "webhooks.get": true,
  "webhooks.list": true,
  workspaces: true,
};

// What an Instantly record never carries. A lead has no LinkedIn fields, no
// location and no tags, and no report says how many emails were delivered.
export const fields: FieldDeclaration = {
  lead: {
    companyLinkedinUrl: false,
    linkedinUrl: false,
    location: false,
    tags: false,
  },
  metricRow: {
    connectionsAccepted: false,
    connectionsSent: false,
    contentHash: false,
    delivered: false,
    inmailsSent: false,
    timezone: false,
  },
  sender: { linkedinUrl: false },
  senderHealth: { blacklisted: false, checkedAt: false },
};

export const limits: LimitDeclaration = {
  lanes: {
    [EMAILS_LANE]: [{ perMs: 60_000, requests: 20 }],
    [LABEL_PREDICTION_LANE]: [{ perMs: 30 * DAY_MS, requests: 500 }],
    [LOCAL_FILTERS_LANE]: [{ perMs: DAY_MS, requests: 100 }],
    [LOCAL_SEARCH_LANE]: [{ perMs: DAY_MS, requests: 200 }],
  },
  source:
    "https://developer.instantly.ai/getting-started/rate-limit.md (100/s and 6,000/min per workspace, shared across keys and API versions), the list-email reference (20/min) and the references of POST /lead-labels/ai-reply-label (500 per 30 days), /local-business-search/ai-filters (100 a day) and /local-business-search/search (200 pages a day); read 2026-11-14, not confirmed live",
  windows: [
    { perMs: 1000, requests: 100 },
    { perMs: 60_000, requests: 6000 },
  ],
};

// Where a read needs more than one request, the number here is the usual
// case; the caveats name what can add to it.
export const costs = {
  "blocklist.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // The campaign, its tag assignments, then the tags' names.
  "campaigns.get": { perPage: 3 },
  // The campaigns, their tag assignments, then the tags' names.
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 3 },
  "campaigns.settings": { perPage: 1 },
  "leads.get": { perPage: 1 },
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "lists.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "messages.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "replies.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  // The account, its DNS test, then its warmup analytics.
  "senders.health": { perPage: 3 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  "sequence.subsequences": { pageSize: PAGE_SIZE, perPage: 1 },
  stats: { perPage: 1 },
  "tags.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "webhooks.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "workspaces.list": { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "The reads were run once, read-only, against one live workspace on 2026-11-14. Fixtures are still built from the API V2 documentation, and subsequences, a campaign's own webhooks and a second page of most lists were not exercised because that workspace had none or too few.",
  "Added from the API reference after that live run and not run against a live workspace: stats for every campaign (GET /campaigns/analytics with no id, where open_count is leads and no interested count exists), a mailbox's campaigns (GET /account-campaign-mappings), the unread filter (is_unread), lists.get with its size from verification-stats, webhooks.get, and a sender's tags and mailProvider.",
  "Instantly sends next_starting_after on a last page too (seen live), and the page after it is empty. A listing therefore ends one request late; the small lookups for tags and labels stop at the first page that is not full.",
  "A reply's category is read from the email's i_status using the lead interest status values (seen live: 0, 1, -1 and -2). A received email carries the lead's address but no lead id, so a reply's leadRef is null; a sent message has one. Instantly does not mark an email as automatic, so isAuto is null.",
  "An email's step and a lead's last step are ids of the form sequence_step_variant, each counted from 0 (seen live, not documented); any other form gives a null step. Step analytics count steps from 0 too, and can hold a row with no step for counts Instantly could not tie to one.",
  "Whether reply_count includes automatic replies is not documented; replied uses the unique reply count and repliedAuto the unique automatic count.",
  "Open counts are returned even when a campaign has open tracking turned off, because the analytics response does not say whether tracking was on.",
  "Daily analytics rows do not state their timezone, so timezone is null.",
  "Campaign tags need two more reads (custom-tag-mappings, then custom-tags) and so a key that can read both; an all:read key can. Turn the tags capability off to skip them: campaign tags are then empty.",
  "A page of campaigns reads at most 10 pages of 100 tag assignments. A page with more assignments than that is refused with a Provider error, not returned with tags missing.",
  "A step's delay is documented as the wait before the next email, so a step's delayDays is the delay of the step before it; the first step of a campaign waits 0 and the first step of a subsequence waits its pre_delay.",
  "A campaign's settings, sequence and senders each read the whole campaign object. A sending window's days are assumed to be numbered 0 for Sunday to 6 for Saturday; the documentation only shows the keys 0 to 6.",
  "A campaign's senders are found by reading every mailbox and keeping those named in the campaign's email_list or carrying a tag in its email_tag_list, at two requests per page of mailboxes. A campaign that names tags only is filtered by Instantly.",
  "Sender health is three reads: the account, POST /accounts/test/vitals (a live DNS test, which Instantly may throttle) and POST /accounts/warmup-analytics. The warmup window is not documented. blacklisted and checkedAt are not reported. A DNS record Instantly could not resolve is null, not false.",
  "connected is true for an Active account and false for a Connection Error; every other account status is null.",
  "A lead's engagement.stepIndex is the last step sent, read from its status summary; lastOpenedAt is null when open tracking is off. A lead has no tags in Instantly, and the lead object was seen without a job title.",
  "A lead is found by email with the contacts filter of POST /leads/list, documented only as the emails a lead needs to have. Whether it compares whole addresses and ignores case is not documented and was not run live, so the adapter keeps only the records whose address equals the one asked for, and a page can hold fewer records than Instantly returned. One record comes back per campaign or list the address is in. A lead has no LinkedIn profile: a lookup by profile returns nothing and sends no request.",
  "A lead's interest is the documented label for lt_interest_status. A custom label costs one more read (lead-labels, first 100 labels), made only when a page holds a status that is not a built-in one; the same read gives a reply with a custom status its category.",
  "A listed lead list's size is null: the list object has no count. lists.get reads GET /lead-lists/{id}/verification-stats as well and takes total_leads from it, so one list by id costs two requests. kind is always leads.",
  "Native reads return what Instantly sends, unmapped. dfyAccounts never asks for passwords. Instantly refuses per-mailbox daily analytics (413) on a large workspace unless a mailbox is named, which the per-sender stats always do.",
  "The daily limits of leadLabelPrediction, localBusinessFilters and localBusinessSearch are counted in this process only; a restart forgets what was used.",
  "A webhook made for a custom lead label has no event_type, so its events are empty; custom_interest_value stays in raw. The headers Instantly sends with a delivery can carry a credential, so they are left out of a webhook record's raw. The native read webhook returns them and is not offered to the vendor_read tool; outbound.raw returns a response as it is.",
  "A truncated message body costs one more read of that email (GET /emails/{id}) when bodies are asked for. That read is assumed to share the 20-per-minute limit of the email list.",
  "Messages of a thread are found with the documented search value thread:<id>.",
  "Instantly's email list does not hold every email a campaign sent (seen live: a lead on its sixth step had one sent email and two replies). A timeline or a thread can therefore be shorter than the sequence; a lead's engagement.stepIndex says how far it got. A received email carries the step it replies to.",
];
