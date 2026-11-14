// What the HeyReach adapter declares. Every statement here comes from
// HeyReach's public API documentation; docs/research/heyreach.md records the
// pages and the date they were read. Nothing has been checked against a live
// workspace until 2026-11-14, when the reads were run once against one live
// workspace; the adapter's maturity is `beta`.

import type { OperationCost } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { FieldDeclaration } from "../internal/fields.ts";
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
  // POST /campaign/GetCampaignsForLead takes an email or a profile URL, and
  // POST /lead/GetLead gives the profile.
  "leads.lookup": true,
  // GetLeadsFromCampaign and GetLeadsFromList both filter by creation time.
  "leads.since": "server",
  // Messages live inside conversations (POST /inbox/GetConversationsV3). A
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
  // GetConversationsV3 bounds conversations by the time of their newest
  // message (`from`); the adapter then drops the older messages inside them.
  "messages.since": "server",
  // Auto-tags describe the lead, not a message, so replies carry no category.
  "replies.category": false,
  "replies.list": true,
  "replies.since": "server",
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
  // Every other documented read, by name: see native.ts.
  native: true,
  // POST /webhooks/GetAllWebhooks.
  "webhooks.list": true,
  // CheckApiKey returns no identity and only an organization key can list workspaces.
  workspaces: false,
};

// What a HeyReach record never carries. LinkedIn has no opens, bounces,
// warmup or DNS, and the API reports no step a message belongs to.
export const fields: FieldDeclaration = {
  campaign: { tags: false },
  campaignSettings: false,
  lead: { engagement: false, phone: false, website: false },
  message: { bodyHtml: false, stepIndex: false, variantKey: false },
  metricRow: {
    bounced: false,
    clicked: false,
    clickedTotal: false,
    contentHash: false,
    delivered: false,
    opened: false,
    openedTotal: false,
    repliedAuto: false,
    stepIndex: false,
    unsubscribed: false,
    variantKey: false,
  },
  reply: {
    bodyHtml: false,
    // The lead's newest auto-tag, not a label on the message.
    category: "derived",
    categorySource: "derived",
    isAuto: false,
    stepIndex: false,
    variantKey: false,
  },
  sender: {
    address: false,
    dailyLimit: false,
    mailProvider: false,
    tags: false,
    warmup: false,
  },
  senderHealth: {
    blacklisted: false,
    checkedAt: false,
    dns: false,
    domain: false,
    warmup: false,
  },
  sequence: { name: false },
  tag: false,
  webhook: { createdAt: false },
  workspace: false,
};

export const limits: LimitDeclaration = {
  source:
    "https://docs.heyreach.io/hey-reach-api.md (300 requests per minute, all requests on one limit); read 2026-11-14. Seen live the same day: a burst limit of 15 requests per 2 seconds, which the docs do not mention. The docs do not say whether the limit is per key, per workspace or per organization, and document no rate-limit headers or Retry-After",
  // The Organization Management API has a separate limit of 300 requests a
  // minute (https://docs.heyreach.io/hey-reach-api/organization.md).
  lanes: { organization: [{ perMs: 60_000, requests: 300 }] },
  // The burst limit is not documented. The live API answers 429 with "Limit
  // is 15 requests per 2 second(s)" (seen 2026-11-14), well before the
  // documented 300 a minute is reached.
  windows: [
    { perMs: 2000, requests: 15 },
    { perMs: 60_000, requests: 300 },
  ],
};

export const costs = {
  "blocklist.list": { pageSize: PAGE_SIZE, perPage: 1 },
  "campaigns.get": { perPage: 1 },
  "campaigns.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // The profile and its tags are two requests.
  "leads.get": { perPage: 2 },
  // A campaign's leads. A saved list's leads come up to 1000 a page.
  "leads.list": { pageSize: PAGE_SIZE, perPage: 1 },
  // One person by profile URL: the campaigns and the profile, two requests.
  // By email it is three (campaigns, the lists the address is in, a name
  // search in one list) and one more per profile read to find the address,
  // eight at most; a later page is two again.
  "leads.lookup": { pageSize: PAGE_SIZE, perPage: 2 },
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
  "A lead is looked up by profile URL with two requests (GetCampaignsForLead and GetLead) and returned once per campaign it is in. A lead's id is its profile URL in every campaign, so a person's records share one ref and differ by campaignRef. The timeline is the lead's whole conversation history, the same on each of its records.",
  "A looked-up lead's status follows leadStatus and never says replied, because GetCampaignsForLead reports no message status; Excluded and PendingOrExcludedToBeCalculated are unknown. createdAt is null (the creationTime beside a campaign is the campaign's), tags are empty and interest is null. A lookup cannot be combined with a saved list or a date range.",
  "HeyReach matches a profile URL whatever its scheme, www prefix, trailing slash or query, but by exact case: seen live, a slug sent in upper case is not found. The lookup sends the slug lowercased, so a profile HeyReach stores with upper-case letters would not be found. A slug with non-ASCII letters is sent percent-encoded; how HeyReach stores one is not known.",
  "No HeyReach read returns a profile for an email address. An email lookup asks for the campaigns (which names the person), then one saved list the address is in, searches that list for the name (5 rows at most) and reads each match's profile until one carries the address: four requests in the usual case. An address that is in no saved list, or whose profile is not among those rows, gives an empty page although HeyReach knows it. The record's email is the address asked for, which the profile may hold as its enriched or custom address.",
  "Lookup was checked against one live lead in one campaign. A person in several campaigns (and so a second page of campaigns) and a known person in no campaign were not seen; an empty campaign answer and a 404 from GetCampaignsForLead are both read as no campaigns.",
  "HeyReach has no list of every lead. Leads are read per campaign or per saved list: outbound.campaign(id).leads and outbound.list(id).leads work, and outbound.leads.list() is refused. Walking every list would repeat a lead that sits in several lists, drop its campaign and status, and miss leads whose list was deleted, so it is not offered as a complete list.",
  "A saved list's leads carry tags, custom fields and the auto-tag but no status, campaign or creation time, although the list can be filtered by when a lead was added. A company list's rows are companies, not leads, and are not mapped: read them with outbound.native.reads.companiesFromList.",
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
  "Messages and replies are read from conversations. Checked against one live workspace on 2026-11-14: sender is ME or CORRESPONDENT, and each of 257 conversations carried its whole thread (longest read: 40 messages). Whether a longer thread is cut short is not known.",
  "Conversations are listed with GetConversationsV3, which pages by cursor and bounds a conversation by the time of its newest message. A since filter is sent as that lower bound and the older messages inside each conversation are then dropped, so a page can hold fewer messages than its conversations do. An until filter cannot be sent, because a conversation that continued past it still holds earlier messages; it is applied after fetching. A page marker saved from before the move to V3 (a number) is not valid and starts from the first page.",
  "A message's id is built from the conversation, the time, the side and the text, so an edited message gets a new id. The live API now returns a messageId the API reference does not list; it stays in raw so that existing ids do not change.",
  "A message's threadId is the LinkedIn account id and the conversation id joined by a colon, because one conversation can only be read back with both. A thread read returns the whole conversation in one page and does not know its campaign, so campaignRef is null.",
  "A message's campaign is known only when the listing is filtered to one campaign; otherwise campaignRef is null. A page is a page of conversations, so it can hold more messages than the limit asked for.",
  "Replies carry no category: HeyReach's auto-tag is made from a lead's first campaign reply but is stored on the lead, with no link to a message. It is read as the lead's interest and counted in stats as positive.",
  "The blacklist is two lists read one after the other, leads then companies. An entry's id is prefixed lead- or company- because the two are numbered separately. A blacklisted lead's value is its profile URL, else its email, else its name (kind other); a company's is its name, else its LinkedIn page. matchingStatus and resolutionStage stay in raw.",
  "A webhook subscription lists one event type. Filtering webhooks by campaign is done after fetching and keeps webhooks that cover every campaign. Custom headers are never requested, because they can hold a secret; a request for one webhook by id (native webhookById, or raw) is always sent with includeCustomHeaders=false. HeyReach gives a webhook no creation time.",
  "Native reads return HeyReach's own payloads. Checked read-only against the same live workspace on 2026-11-14: checkApiKey, listById, campaignsForLead, myNetworkForSender, isConnection, campaignSequenceV2, statsByCampaign, proxyCountries, conversationsV2, voices, staticClips, elevenLabsConnection, elevenLabsVoices and voiceUsage answered 200; listsForLead, staticClip, senderVoice, webhookById and enrichEmailJob answered a documented 404 because the workspace had nothing to return; companiesFromList answered 400 for a lead list, the workspace having no company list. The five organization reads answer 401 with a workspace key and were not seen with an organization key.",
  "Three documented reads are not offered: the workspace API keys and a LinkedIn account's proxy (both return secrets, and raw refuses them), and a voice message's audio file, which is not JSON and would not survive the request engine, which reads every body as text. A voice message's transcript and duration are in its conversation.",
  "The workspace's tags cannot be listed: the API creates tags and reads one lead's tags, nothing more. A tag has a name and a colour and no id.",
  "Only the voice_note_received webhook payload is documented. Other events are assumed to share its skeleton, and the lowercase event_type names are inferred from two examples.",
  "Webhooks are not signed; correlation_id is the only identifier and is assumed to be stable across redelivery.",
];
