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

export const capabilities: CapabilityDeclaration = {
  "campaigns.status": "server",
  "events.parse": true,
  // Instantly does not sign webhooks. Use a secret header or URL path.
  "events.verify": "secret",
  "leads.byCampaign": true,
  "leads.get": true,
  "leads.list": true,
  // POST /leads/list has no date filter, so the wrapper filters after fetching.
  "leads.since": "client",
  "leads.timeline": true,
  // A list response can cut a large body short (`body_fallback_reason`).
  "messages.body": "sampled",
  "messages.list": true,
  "messages.since": "server",
  "replies.category": "vendor",
  "replies.list": true,
  "replies.since": "server",
  // A campaign can attach mailboxes by tag as well as by address, and the
  // API does not expand the tag, so the list would be silently incomplete.
  "senders.byCampaign": false,
  "senders.get": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  "stats.byDay": "exact",
  // Per-mailbox numbers exist by day only; a total is summed by the adapter.
  "stats.bySender": "derived",
  "stats.byStep": "exact",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
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

export const costs = {
  "campaigns.get": { perPage: 1 },
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "leads.get": { perPage: 1 },
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "messages.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "replies.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  stats: { perPage: 1 },
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
  "Campaign tags are not part of the campaign object, so tags is always empty.",
];
