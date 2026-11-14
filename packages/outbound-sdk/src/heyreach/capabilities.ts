// What the HeyReach adapter declares. Every statement here comes from
// HeyReach's public API documentation; docs/research/heyreach.md records the
// pages and the date they were read. Nothing has been checked against a live
// workspace until 2026-11-14, when the reads were run once against one live
// workspace; the adapter's maturity is `beta`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { LimitDeclaration } from "../internal/limits.ts";

export const BASE_URL = "https://api.heyreach.io/api/public";
export const API_KEY_ENV = "HEYREACH_API_KEY";
export const WORKSPACE_ENV = "HEYREACH_WORKSPACE_ID";

/** The documented maximum for the lists this adapter reads. */
export const PAGE_SIZE = 100;

/** `POST /list/GetLeadsFromList` alone returns up to 1000 rows. */
export const LIST_LEADS_PAGE_SIZE = 1000;

export const capabilities: CapabilityDeclaration = {
  // POST /blacklist/GetLeads, then POST /blacklist/GetCompanies.
  blocklist: true,
  // A campaign's schedule can only be written (POST /campaign/UpdateSchedule).
  // GET /campaign/GetById returns no schedule, limits or stop rules.
  "campaigns.settings": false,
  // POST /campaign/GetAll takes a `statuses` array.
  "campaigns.status": "server",
  "events.parse": true,
  // HeyReach documents no signature. A webhook can carry a static custom header.
  "events.verify": "secret",
  // POST /campaign/GetLeadsFromCampaign.
  "leads.byCampaign": true,
  // No lead shape carries open, click or reply counts.
  "leads.engagement": false,
  "leads.get": true,
  // HeyReach has no list of every lead: leads are read per campaign or per list.
  "leads.list": false,
  // GetLeadsFromCampaign and GetLeadsFromList both filter by creation time.
  "leads.since": "server",
  // Messages live inside conversations (POST /inbox/GetConversationsV2). A
  // lead's timeline is the conversations filtered to its profile URL.
  "leads.timeline": true,
  // POST /list/GetLeadsFromList.
  "lists.leads": true,
  // POST /list/GetAll.
  "lists.list": true,
  "messages.body": "full",
  // GET /inbox/GetChatroom/{accountId}/{conversationId}.
  "messages.byThread": true,
  "messages.list": true,
  // The inbox has no date filter, so the wrapper filters after fetching.
  "messages.since": "client",
  // Auto-tags describe the lead, not a message, so replies carry no category.
  "replies.category": false,
  "replies.list": true,
  "replies.since": "client",
  // GET /campaign/GetById names the campaign's account ids; the account list
  // is narrowed to them.
  "senders.byCampaign": true,
  "senders.get": true,
  // GET /li_account/GetAccountStatus/{accountId}.
  "senders.health": true,
  "senders.list": true,
  // LinkedIn accounts have no warmup.
  "senders.warmup": false,
  sequence: true,
  // A campaign has one sequence tree and nothing attached to it.
  "sequence.subsequences": false,
  "stats.byDay": "exact",
  // GetOverallStats filtered to one account id.
  "stats.bySender": "exact",
  "stats.byStep": false,
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  // Tags can be created (POST /lead_tags/CreateTags) and read per lead
  // (POST /lead/GetTags), but no endpoint lists the workspace's tags.
  tags: false,
  // POST /webhooks/GetAllWebhooks.
  "webhooks.list": true,
  // CheckApiKey returns no identity and only an organization key can list workspaces.
  workspaces: false,
};

export const limits: LimitDeclaration = {
  source:
    "https://docs.heyreach.io/hey-reach-api.md (300 requests per minute, all requests on one limit); read 2026-11-14, not confirmed live. The docs do not say whether the limit is per key, per workspace or per organization, and document no rate-limit headers or Retry-After",
  windows: [{ perMs: 60_000, requests: 300 }],
};

export const costs = {
  "blocklist.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "campaigns.get": { perPage: 1 },
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // The profile and its tags are two requests.
  "leads.get": { perPage: 2 },
  // A campaign's leads. A saved list's leads come up to 1000 a page.
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "lists.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // One conversation by thread id is a single request.
  "messages.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "replies.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "senders.get": { perPage: 1 },
  "senders.health": { perPage: 1 },
  // A campaign's senders cost one more request, once, to read the campaign.
  "senders.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "sequence.get": { perPage: 1 },
  stats: { perPage: 1 },
  "webhooks.list": { pageSize: PAGE_SIZE, perPage: 1 },
} satisfies Record<string, OperationCost>;

export const caveats: readonly string[] = [
  "Checked read-only against one live HeyReach workspace on 2026-11-14: campaigns, sequences, senders, a campaign's senders, sender health, a campaign's leads, lead lists, a list's leads, lead lookup, the blacklist, the webhook list, stats, messages, replies, one conversation by thread id and a lead's timeline all returned valid records. Other workspaces, plans and campaign layouts have not been seen. That workspace had no webhooks, no blacklisted leads and no company lists, so those three shapes come from the documentation alone. Webhook payloads were not checked. The fixtures are built by hand from documented and observed field names, not captured responses.",
  "The 300 requests per minute limit is documented without a scope (key, workspace or organization) and without rate-limit headers, and the workspace's n8n, Make, Zapier and MCP keys may draw on the same budget.",
  "Lists return totalCount and no next marker, so the end of a list is computed as offset plus page length reaching totalCount.",
  "The campaign list's item fields come from a schema that disagrees with the documented GetById example; only id, name, creationTime and status are read. HeyReach campaigns have no tags.",
  "A campaign's settings cannot be read: the schedule, start and end dates are write-only (UpdateSchedule) and GetById returns none of them. Sending limits belong to the LinkedIn account, not the campaign. The exclusion switches GetById does return stay in raw.",
  "A campaign's senders are the account list narrowed to the campaign's campaignAccountIds, so an account that was removed from the workspace is left out and a page can come back short or empty.",
  "A sender's health is its connection state only: connected is true for the status Connected and false for Disconnected, the two values seen; any other status is null. failureReason is the one issue reported. HeyReach caches the status for 10 seconds and gives no check time.",
  "Campaign statuses are documented by name only. STARTING is mapped to active, SCHEDULED to draft, CANCELED to completed and FAILED to unknown.",
  "A sender's status is derived from two undefined booleans: authIsValid false is disconnected, otherwise isActive true is active and false is paused.",
  "A sender's dailyLimit is null: accountLimits holds several limit pairs and the docs do not say which are daily or what Limit and Max mean. They stay in raw.",
  "A lead's id is its LinkedIn profile URL, the only key GetLead accepts and the only one present in every lead shape. The docs do not say the URL has one canonical form.",
  "HeyReach has no list of every lead. Leads are read per campaign or per saved list: outbound.campaign(id).leads and outbound.list(id).leads work, and outbound.leads.list() is refused. Walking every list would repeat a lead that sits in several lists, drop its campaign and status, and miss leads whose list was deleted, so it is not offered as a complete list.",
  "A saved list's leads carry tags, custom fields and the auto-tag but no status, campaign or creation time, although the list can be filtered by when a lead was added. A company list's rows are companies, not leads, and are not mapped: read them with raw POST /list/GetCompaniesFromList.",
  "A lead's interest is the name of its newest auto-tag (Interested, Not interested and Generic were seen live; the API reference does not list the names). It is present on a list's leads and absent from a campaign's leads and from lead lookup, where it is null.",
  "A lead's tags come from the list row, or from a second request (POST /lead/GetTags) on lead lookup. A campaign's leads carry no tags, so theirs are empty.",
  "No lead shape carries open, click or reply counts, so engagement is always null. lastActionTime, leadConnectionStatus and leadMessageStatus stay in raw.",
  "A campaign's lead list was seen live to include finished leads, although the documentation describes it as pending leads only.",
  "A lead's status is replied when leadMessageStatus is MessageReply, otherwise it follows leadCampaignStatus with Pending as active. Failed has no equivalent and is unknown.",
  "A lead's email falls back from emailAddress to enrichedEmailAddress to customEmailAddress. The docs do not say which of the three is the newest.",
  "A sequence is a node tree and every node that acts on the lead is a step. Steps are numbered node first, then its conditional branch, then its unconditional branch, so an index is stable until the tree is edited. CHECK_ nodes are conditions, not steps: the steps under one share its parent and carry its outcome as their branch, so a campaign that opens with CHECK_IS_CONNECTION has two steps with no parent.",
  "Branch names are ours for the documented conditions: accepted and not_accepted after CONNECTION_REQUEST, connected and not_connected after CHECK_IS_CONNECTION, open_profile and not_open_profile after CHECK_IS_OPEN_PROFILE, email_found and email_not_found after FIND_EMAIL. Two conditions in a row are joined with a plus sign. Any other node with steps on its conditional branch uses HeyReach's own words, conditional and unconditional. Only the CONNECTION_REQUEST and CHECK_IS_CONNECTION layouts were seen live.",
  "The step after a MESSAGE or INMAIL has no branch: a reply ends the sequence, so every later step already means the lead has not replied. A step's delayDays includes the wait of any CHECK_ node between it and its parent.",
  "Sequence variants come from payload.messages (or messageVersions), which the docs describe as A/B variants for MESSAGE nodes only; INMAIL and LIKE_POST payloads are not documented.",
  "Stats: replied is totalMessageReplies plus totalInmailReplies. contacted is uniqueLeadsContacted and positive is autoTaggedInterested; the live API returns both but the API reference lists neither, so they are null when absent. totalMessageStarted and totalInmailStarted are not defined in the docs and are not read.",
  "Daily stats are keyed by UTC midnight; the docs do not say which timezone buckets a day or whether endDate is inclusive. Stats need both from and to, or neither.",
  "Messages and replies are read from conversations. Checked against one live workspace on 2026-11-14: sender is ME or CORRESPONDENT, and each conversation carried its whole thread (longest read: 11 messages). Whether a very long thread is cut short is not known.",
  "A message's id is built from the conversation, the time, the side and the text, so an edited message gets a new id. The live API now returns a messageId the API reference does not list; it stays in raw so that existing ids do not change.",
  "A message's threadId is the LinkedIn account id and the conversation id joined by a colon, because one conversation can only be read back with both. A thread read returns the whole conversation in one page and does not know its campaign, so campaignRef is null.",
  "A message's campaign is known only when the listing is filtered to one campaign; otherwise campaignRef is null. A page is a page of conversations, so it can hold more messages than the limit asked for.",
  "Replies carry no category: HeyReach's auto-tag is made from a lead's first campaign reply but is stored on the lead, with no link to a message. It is read as the lead's interest and counted in stats as positive. The docs mention a deep-paging ceiling on conversations without stating it.",
  "The blacklist is two lists read one after the other, leads then companies. An entry's id is prefixed lead- or company- because the two are numbered separately. A blacklisted lead's value is its profile URL, else its email, else its name (kind other); a company's is its name, else its LinkedIn page. matchingStatus and resolutionStage stay in raw.",
  "A webhook subscription lists one event type. Filtering webhooks by campaign is done after fetching and keeps webhooks that cover every campaign. Custom headers are never requested, because they can hold a secret. HeyReach gives a webhook no creation time.",
  "The workspace's tags cannot be listed: the API creates tags and reads one lead's tags, nothing more. A tag has a name and a colour and no id.",
  "Only the voice_note_received webhook payload is documented. Other events are assumed to share its skeleton, and the lowercase event_type names are inferred from two examples.",
  "Webhooks are not signed; correlation_id is the only identifier and is assumed to be stable across redelivery.",
];
