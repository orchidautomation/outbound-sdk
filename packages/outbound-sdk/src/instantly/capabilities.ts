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

/**
 * `GET /emails` has its own limit of 20 a minute, far below the workspace
 * limit. Every process on the workspace draws on it: the general limit is
 * documented as workspace-wide, and on 2026-11-16 a second process reading
 * emails slowed the first from 0.76 s to 121 s. The SDK counts per process
 * unless a shared `rateLimitStore` is given, so two processes on one key
 * meet at Instantly's 429. See docs/research/instantly.md.
 */
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
  // GET /campaigns/analytics for one id: leads_count and completed_count.
  "campaigns.progress": true,
  "campaigns.settings": true,
  // Draft and completed are filtered by Instantly. Active and paused each
  // cover several Instantly statuses, so the adapter matches those itself.
  "campaigns.status": "server",
  "events.parse": true,
  // Instantly does not sign webhooks. Use a secret header or URL path.
  "events.verify": "secret",
  "leads.byCampaign": true,
  // The `search` field of POST /leads/list, which matches whole words of the
  // lead's email; the adapter keeps only addresses at exactly that domain.
  "leads.byDomain": true,
  // The `filter` field of POST /leads/list, one positive interest status
  // (FILTER_LEAD_INTERESTED and the rest) after another.
  "leads.byInterest": true,
  // The `filter` FILTER_VAL_ACTIVE of POST /leads/list; the adapter keeps
  // only the leads it maps to active, so the answer is exact either way.
  "leads.byStatus": true,
  "leads.engagement": true,
  "leads.get": true,
  "leads.list": true,
  // By email only, with the `contacts` filter of POST /leads/list. A lead has
  // no LinkedIn profile, so a lookup by profile finds nothing.
  "leads.lookup": true,
  // The same `contacts` filter, given many addresses at once.
  "leads.lookupMany": true,
  // POST /leads/list has no date filter, so the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  // GET /inbox-placement-tests.
  "placementTests.list": true,
  // GET /lead-lists/{id}, then its verification-stats for the size.
  "lists.get": true,
  "lists.leads": true,
  "lists.list": true,
  // A list response can cut a large body short (`body_fallback_reason`); the
  // adapter then reads that email on its own, where the body is whole.
  "messages.body": "full",
  // email_type=manual on GET /emails, kept to ue_type 3 (sent, not from a campaign).
  "messages.byHand": true,
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
  "senders.healthList": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  "sequence.subsequences": true,
  "stats.byDay": "exact",
  // Per-mailbox numbers exist by day only; a total is summed by the adapter.
  "stats.bySender": "derived",
  "stats.byStep": "exact",
  // GET /campaigns/analytics with no id: a row per campaign, totals only.
  // Partial: it has no count of interested leads and no total of opens.
  "stats.allCampaigns": "partial",
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
  // The per-campaign report counts every lead and the finished ones only.
  campaignProgress: {
    blocked: false,
    failed: false,
    inProgress: false,
    notStarted: false,
    skipped: false,
    stopped: false,
  },
  lead: {
    companyLinkedinUrl: false,
    linkedinUrl: false,
    location: false,
    tags: false,
  },
  // No email carried is_auto_reply live: a fixed rule decides, and in a
  // timeline the step comes from the send a reply answers. The Unibox link is
  // built from the thread and workspace, as Instantly's own unibox_url is.
  message: { isAuto: "derived", isAutoSource: "derived", url: "derived" },
  metricRow: {
    connectionsAccepted: false,
    connectionsSent: false,
    contentHash: false,
    delivered: false,
    inmailsSent: false,
    timezone: false,
  },
  // A test has a creation time and a next run, and no start or end date.
  placementTest: { endsAt: false, startsAt: false },
  reply: {
    isAuto: "derived",
    isAutoSource: "derived",
    leftCompany: "derived",
    url: "derived",
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
// A listing that ends by itself costs one more, empty, page: Instantly sends
// a next cursor on its last page too (see the caveats). That page is perWalk.
export const costs = {
  "blocklist.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  // The campaign, its tag assignments, then the tags' names.
  "campaigns.get": { perPage: 3 },
  // The campaigns, their tag assignments, then the tags' names.
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 3, perWalk: 1 },
  // The per-campaign report, asked for one campaign.
  "campaigns.progress": { perPage: 1 },
  "campaigns.settings": { perPage: 1 },
  // A custom interest label costs one more read of the label list, made only
  // when the lead or a page of leads holds one.
  "leads.get": { perPage: 1, perWalk: 1 },
  "leads.list": {
    pageSize: PAGE_SIZE,
    perPage: 1,
    perPageAtMost: 2,
    perWalk: 1,
  },
  "lists.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  "messages.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  // The same label read, for a page of replies with a custom status.
  "replies.list": {
    pageSize: PAGE_SIZE,
    perPage: 1,
    perPageAtMost: 2,
    perWalk: 1,
  },
  "senders.get": { perPage: 1 },
  // The account, its DNS test, then its warmup analytics.
  "senders.health": { perPage: 3 },
  // Every mailbox's health: a page of accounts, one DNS test for the page's
  // domains and one warmup report for its mailboxes. A campaign's page reads
  // the campaign again first.
  "senders.healthList": { pageSize: PAGE_SIZE, perPage: 3, perPageAtMost: 4 },
  // A campaign's senders: the campaign again with each page of every mailbox,
  // kept when the campaign names it (see the caveats). Pages follow the
  // workspace's mailboxes, not the senders kept.
  "senders.byCampaign": { pageSize: PAGE_SIZE, perPage: 2, perWalk: 1 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  "sequence.get": { perPage: 1 },
  "sequence.subsequences": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  // The counts, then the tracking settings: the campaign, or for a workspace
  // or mailbox the per-campaign report and the campaign listing. The bound
  // is for up to 100 campaigns; each further 100 adds a listing page.
  stats: { perPage: 2, perPageAtMost: 3 },
  "tags.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  "webhooks.list": { pageSize: PAGE_SIZE, perPage: 1, perWalk: 1 },
  "workspaces.list": { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "The reads were run once, read-only, against one live workspace on 2026-11-14. Fixtures are still built from the API V2 documentation, and subsequences, a campaign's own webhooks and a second page of most lists were not exercised because that workspace had none or too few.",
  "Added from the API reference after that live run and not run against a live workspace: stats for every campaign (GET /campaigns/analytics with no id, where open_count is leads and no interested count exists), a mailbox's campaigns (GET /account-campaign-mappings), the unread filter (is_unread), lists.get with its size from verification-stats, webhooks.get, and a sender's tags and mailProvider.",
  "A lead's progress is its status when that is 1 (active), 2 (paused) or 3 (completed). Status -1 is bounced and -2 unsubscribed: they say what came back, so progress is then unknown. replied is email_reply_count above 0, and a lead that replied has the status replied whatever its progress.",
  "A placement test's kind reads type 1 as a one-time test and 2 as an automated one: the reference names the two kinds in that order and gives the numbers no names. A test's results stay native, because Instantly reports them as one row per test email.",
  "Instantly sends next_starting_after on a last page too (seen live), and the page after it is empty. A listing therefore ends one request late; the small lookups for tags and labels stop at the first page that is not full.",
  "A reply's category is read from the email's i_status using the lead interest status values (seen live: 0, 1, -1 and -2). An email names its lead by address (lead_id was absent live), so a message's or reply's leadRef holds the lead's lowercased address, from lead or, on a received email, from_address_email. leads.get and leads.timeline take that ref; leads.get then returns the first record with the address, one of several when the person is in several campaigns. No live email carried the documented is_auto_reply and the email list cannot filter by it, so when it is missing isAuto is decided by a fixed rule (isAutoSource rule): a machine sender address (noreply, auto-responder, mailer-daemon), an automatic subject (OOO, Out of Office, Automatic reply, \"is no longer at\"), a canned autoresponder phrase in the body, or, in a timeline or thread, a reply within a minute of the send it answers. An Out of Office i_status counts as the vendor saying so. leftCompany is true when the reply says the person left or the contact changed. In a timeline or thread a received email takes its stepIndex from the send it answers, since its own step lags on the last step.",
  "Messages sent by hand (byHand) are read with email_type=manual on GET /emails, which the reference names but does not describe, and only emails with ue_type 3 (Sent) are kept: a campaign send is ue_type 1. Not run against a live workspace.",
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
  "Every mailbox's health (senderHealth) is read a page of 100 accounts at a time: the page, one POST /accounts/test/vitals naming one mailbox of each domain on it, and one POST /accounts/warmup-analytics naming every mailbox on it. The DNS test answers per domain, so each mailbox gets its domain's answer. Seen live on 2026-11-17: one test of 137 domains answered in about 2 seconds.",
  "connected is true for an Active account and false for a Connection Error; every other account status is null.",
  "A lead's engagement.stepIndex is the last step sent, read from its status summary; lastOpenedAt is null when open tracking is off. A lead has no tags in Instantly, and the lead object was seen without a job title.",
  "A lead is found by email with the contacts filter of POST /leads/list, documented only as the emails a lead needs to have. Whether it compares whole addresses and ignores case is not documented and was not run live, so the adapter keeps only the records whose address equals the one asked for, and a page can hold fewer records than Instantly returned. One record comes back per campaign or list the address is in. A lead has no LinkedIn profile: a lookup by profile returns nothing and sends no request.",
  "Leads at one domain are found with the search field of POST /leads/list, documented (read 2026-11-16) as matched against the lead's email and profile fields on whole words and the start of a value. Whether an address's domain counts as a whole word was not run live. The search also matches names, companies and titles, so the adapter keeps only the records whose address is at exactly that domain, and a page can hold fewer records than Instantly returned.",
  "A lead's interest is the documented label for lt_interest_status. A custom label costs one more read (lead-labels, first 100 labels), made only when a page holds a status that is not a built-in one; the same read gives a reply with a custom status its category.",
  "A listed lead list's size is null: the list object has no count. lists.get reads GET /lead-lists/{id}/verification-stats as well and takes total_leads from it, so one list by id costs two requests. kind is always leads.",
  "Native reads return what Instantly sends, unmapped. dfyAccounts never asks for passwords. Instantly refuses per-mailbox daily analytics (413) on a large workspace unless a mailbox is named, which the per-sender stats always do.",
  "The daily limits of leadLabelPrediction, localBusinessFilters and localBusinessSearch are counted in this process only; a restart forgets what was used.",
  "A webhook made for a custom lead label has no event_type, so its events are empty; custom_interest_value stays in raw. The headers Instantly sends with a delivery can carry a credential, so they are left out of a webhook record's raw. The native read webhook returns them and is not offered to the vendor_read tool; outbound.raw returns a response as it is.",
  "A truncated message body costs one more read of that email (GET /emails/{id}) when bodies are asked for. That read is assumed to share the 20-per-minute limit of the email list.",
  "Messages of a thread are found with the documented search value thread:<id>.",
  "Instantly's email list does not hold every email a campaign sent (seen live: a lead on its sixth step had one sent email and two replies). A timeline or a thread can therefore be shorter than the sequence; a lead's engagement.stepIndex says how far it got. A received email carries the step it replies to.",
  "A message's or reply's url opens its thread in the Unibox: https://app.instantly.ai/app/unibox?thread_search=thread:<thread_id>&selected_wks=<organization_id>. Instantly documents unibox_url on reply webhooks (\"URL to view the conversation in Unibox\") but not how it is built; on 2026-11-17 the unibox_url of four live reply_received deliveries, all naming one email, was exactly this, from that email's thread_id and organization_id. The link needs a signed-in Instantly session, and was not opened in a browser. An email without a thread_id or organization_id has a null url.",
];
