// What the Instantly adapter declares. Every statement here comes from
// Instantly's API V2 documentation; docs/research/instantly.md records the
// pages and the date they were read. Nothing has been checked against a live
// workspace yet, which is why the adapter's maturity is `unverified`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://api.instantly.ai/api/v2";
export const API_KEY_ENV = "INSTANTLY_API_KEY";
export const WORKSPACE_ENV = "INSTANTLY_WORKSPACE_ID";

/** `GET /emails` has its own limit, far below the workspace limit. */
export const EMAILS_LANE = "emails";
export const PAGE_SIZE = 100;

/** How many pages of tag assignments are read for one page of campaigns. */
export const TAG_PAGES = 10;

export const capabilities: CapabilityDeclaration = {
  blocklist: true,
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
  // POST /leads/list has no date filter, so the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  "lists.leads": true,
  "lists.list": true,
  // A list response can cut a large body short (`body_fallback_reason`); the
  // adapter then reads that email on its own, where the body is whole.
  "messages.body": "full",
  "messages.byThread": true,
  "messages.list": true,
  "messages.since": "server",
  "replies.category": "vendor",
  "replies.list": true,
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
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  tags: true,
  "webhooks.list": true,
  workspaces: true,
};

export const limits: LimitDeclaration = {
  lanes: { [EMAILS_LANE]: [{ perMs: 60_000, requests: 20 }] },
  source:
    "https://developer.instantly.ai/getting-started/rate-limit.md (100/s and 6,000/min per workspace, shared across keys and API versions) and the list-email reference (20/min); read 2026-11-14, not confirmed live",
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
  "Nothing has been checked against a live Instantly workspace; every mapping follows the API V2 documentation read on 2026-11-14.",
  "The end of a list is assumed to be a response without next_starting_after. The documentation does not say.",
  "A reply's category is read from the email's i_status using the lead interest status values. The documentation does not list the values i_status takes.",
  "An email's step is documented only as a string; it is mapped to a step index only when it is a whole number.",
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
  "A lead's engagement has no stepIndex: Instantly names the last step by an id, not a position. A lead has no tags in Instantly.",
  "A lead's interest is the documented label for lt_interest_status. A custom label costs one more read (lead-labels, first 100 labels), made only when a page holds a status that is not a built-in one; the same read gives a reply with a custom status its category.",
  "A lead list's size is null: the list object has no count. kind is always leads.",
  "A webhook made for a custom lead label has no event_type, so its events are empty; custom_interest_value stays in raw. raw also holds the headers Instantly sends, which can carry a secret.",
  "A truncated message body costs one more read of that email (GET /emails/{id}) when bodies are asked for. That read is assumed to share the 20-per-minute limit of the email list.",
  "Messages of a thread are found with the documented search value thread:<id>.",
];
