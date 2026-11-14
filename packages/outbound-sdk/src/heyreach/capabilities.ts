// What the HeyReach adapter declares. Every statement here comes from
// HeyReach's public API documentation; docs/research/heyreach.md records the
// pages and the date they were read. Nothing has been checked against a live
// workspace yet, which is why the adapter's maturity is `unverified`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://api.heyreach.io/api/public";
export const API_KEY_ENV = "HEYREACH_API_KEY";
export const WORKSPACE_ENV = "HEYREACH_WORKSPACE_ID";

/** The documented maximum for the lists this adapter reads. */
export const PAGE_SIZE = 100;

export const capabilities: CapabilityDeclaration = {
  // POST /campaign/GetAll takes a `statuses` array.
  "campaigns.status": "server",
  "events.parse": true,
  // HeyReach documents no signature. A webhook can carry a static custom header.
  "events.verify": "secret",
  // POST /campaign/GetLeadsFromCampaign.
  "leads.byCampaign": true,
  "leads.get": true,
  // HeyReach has no list of every lead: leads are read per campaign.
  "leads.list": false,
  // GetLeadsFromCampaign filters by creation time.
  "leads.since": "server",
  // Messages exist only inside conversations: they have no id, the lead's
  // `sender` value is not documented, and the docs do not say whether a
  // conversation carries its whole thread. Guessing would be worse than no.
  "leads.timeline": false,
  "messages.body": false,
  "messages.list": false,
  "messages.since": false,
  "replies.category": false,
  "replies.list": false,
  "replies.since": false,
  // A campaign names its account ids, but no endpoint lists accounts by campaign.
  "senders.byCampaign": false,
  "senders.get": true,
  "senders.list": true,
  // LinkedIn accounts have no warmup.
  "senders.warmup": false,
  sequence: true,
  "stats.byDay": "exact",
  // GetOverallStats filtered to one account id.
  "stats.bySender": "exact",
  "stats.byStep": false,
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  // CheckApiKey returns no identity and only an organization key can list workspaces.
  workspaces: false,
};

export const limits: LimitDeclaration = {
  source:
    "https://docs.heyreach.io/hey-reach-api.md (300 requests per minute, all requests on one limit); read 2026-11-14, not confirmed live. The docs do not say whether the limit is per key, per workspace or per organization, and document no rate-limit headers or Retry-After",
  windows: [{ perMs: 60_000, requests: 300 }],
};

export const costs = {
  "campaigns.get": { perPage: 1 },
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "leads.get": { perPage: 1 },
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  stats: { perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "Nothing has been checked against a live HeyReach workspace; every mapping follows the public API documentation read on 2026-11-14.",
  "The 300 requests per minute limit is documented without a scope (key, workspace or organization) and without rate-limit headers, and the workspace's n8n, Make, Zapier and MCP keys may draw on the same budget.",
  "Lists return totalCount and no next marker, so the end of a list is computed as offset plus page length reaching totalCount.",
  "The campaign list's item fields come from a schema that disagrees with the documented GetById example; only id, name, creationTime and status are read.",
  "Campaign statuses are documented by name only. STARTING is mapped to active, SCHEDULED to draft, CANCELED to completed and FAILED to unknown.",
  "A sender's status is derived from two undefined booleans: authIsValid false is disconnected, otherwise isActive true is active and false is paused.",
  "A sender's dailyLimit is null: accountLimits holds several limit pairs and the docs do not say which are daily or what Limit and Max mean. They stay in raw.",
  "A lead's id is its LinkedIn profile URL, the only key GetLead accepts and the only one present in every lead shape. The docs do not say the URL has one canonical form.",
  "HeyReach has no list of every lead. Leads are read per campaign: outbound.campaign(id).leads works and outbound.leads.list() is refused.",
  "GetLeadsFromCampaign shows only the pending leads that are about to start, so a campaign's lead count can be lower than its list.",
  "A lead's status is replied when leadMessageStatus is MessageReply, otherwise it follows leadCampaignStatus with Pending as active. Failed has no equivalent and is unknown.",
  "A lead's email falls back from emailAddress to enrichedEmailAddress.",
  "A sequence is a node tree. It is flattened by following, at each node, the one branch that holds further steps; a step after a branching node runs only for leads who took that branch. A tree where both branches hold steps is refused.",
  "Sequence variants come from payload.messages (or messageVersions), which the docs describe as A/B variants for MESSAGE nodes only; INMAIL and LIKE_POST payloads are not documented.",
  "Stats: replied is totalMessageReplies plus totalInmailReplies. totalMessageStarted and totalInmailStarted are not defined in the docs and are not read, so contacted is null and reply rates divide by messages sent.",
  "Daily stats are keyed by UTC midnight; the docs do not say which timezone buckets a day or whether endDate is inclusive. Stats need both from and to, or neither.",
  "Messages and replies are not listed: conversation messages have no id and the lead's sender value is not documented. The inbox endpoints are reachable through raw.",
  "Only the voice_note_received webhook payload is documented. Other events are assumed to share its skeleton, and the lowercase event_type names are inferred from two examples.",
  "Webhooks are not signed; correlation_id is the only identifier and is assumed to be stable across redelivery.",
];
