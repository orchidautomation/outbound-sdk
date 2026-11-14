# HeyReach public API research (read operations)

> This is the research record the HeyReach adapter was written from. The companion files it mentions (`endpoints.json`, `limits.json`, `sources/`) were working files and are not in this repository; the fixtures used by the tests are in `fixtures/heyreach/`.

Sections 0 to 10 were fetched 2026-11-14 from public documentation only. No credentials were used for them. The section "Account-level reads" near the end was added the same day from a fresh fetch of the docs plus read-only requests to one live workspace. One unauthenticated request was made to `GET /api/public/auth/CheckApiKey` (no key) to see the 401 shape; everything else is from docs.

Terms used below:

- **Sender** = a LinkedIn account connected to HeyReach (`li_account`). There are no email mailboxes.
- **Workspace** = HeyReach's tenant unit inside an organization. Agencies usually keep one workspace per client.
- **POST-for-read** = an endpoint that only reads data but must be called with POST and a JSON body.

## 0. Basics

| Item | Value |
| --- | --- |
| Base URL | `https://api.heyreach.io/api/public` |
| Auth | Header `X-API-KEY: <key>`. No bearer token, no query-param form. |
| Content type | Send `Content-Type: application/json`. Docs examples send `Accept: text/plain`, but responses are `application/json`. |
| Versioning | None. No version in the path or headers. New versions are new endpoint names (`GetConversationsV2` → `GetConversationsV3`, `GetCampaignSequence` → `GetCampaignSequenceV2`). |
| Naming | RPC style: `/<area>/<VerbNoun>`. Most list reads are POST with a JSON body. |
| List envelope | `{ "totalCount": <int>, "items": [...] }` on almost every list. No `next` marker (except V3 conversations). |
| IDs | Campaign, list, sender, webhook, workspace ids are integers. Conversation id and lead `linkedin_id` are strings. |
| Timestamps | ISO 8601 UTC strings with fractional seconds, e.g. `2025-12-01T08:06:15.463169Z`. |

Two official doc sources exist and they are not identical:

1. **docs.heyreach.io** (Fern site, with `llms.txt`, per-page `.md`, and `openapi.json`). Newer and larger: 105 paths. Saved as `sources/openapi.json`.
2. **Postman documenter** (collection `publishDate` 2026-09-16). 88 requests. Missing the voice endpoints, the V2 sequence endpoints and the `VOICE_NOTE_RECEIVED` webhook text. Saved as `sources/postman-collection.json`.

The OpenAPI file is generated from the Postman collection, so its types are weak: many response fields are typed `string` because the Postman example held `"<integer>"` placeholders, `servers` is the broken value `https://api`, and paths start with `//api/public/...`. Use it for field names and descriptions, not for types. There is no public Swagger on `api.heyreach.io` (`/swagger`, `/openapi.json`, `/api-docs` redirect-loop or 404).

## 1. Campaigns

### List campaigns — `POST /campaign/GetAll` (POST-for-read)

Body (all optional in practice; the generated schema marks them all required):

| Field | Type | Notes |
| --- | --- | --- |
| `offset` | integer | default 0 |
| `limit` | integer | max 100; default 10 (default is from the MCP tool schema) |
| `keyword` | string | name search |
| `statuses` | string[] | see enum below |
| `accountIds` | integer[] | sender ids |

Response `{ totalCount, items }`. Documented item fields: `id`, `name`, `creationTime`, `linkedInUserListName`, `linkedInUserListId`, `campaignAccountIds` (int[]), `status`, `progressStats { totalUsers, totalUsersInProgress, totalUsersPending, totalUsersFinished, totalUsersFailed }`, `excludeAlreadyMessagedGlobal`, `excludeAlreadyMessagedCampaignAccounts`, `excludeFirstConnectionCampaignAccounts`, `excludeFirstConnectionGlobal`, `excludeNoProfilePicture`, `excludeListId`.

### Get one campaign — `GET /campaign/GetById?campaignId=<long>`

Bare object. The docs give a real example here, and its fields differ from the list schema: `id`, `name`, `creationTime`, `linkedInUserListName`, `linkedInUserListId`, `campaignAccountIds`, `status`, `progressStats` (adds `totalUsersManuallyStopped`, `totalUsersExcluded`), `excludeInOtherCampaigns`, `excludeHasOtherAccConversations`, `excludeContactedFromSenderInOtherCampaign`, `excludeListId`, `organizationUnitId`.

The `exclude*` names in the list schema look stale (they match no current write endpoint; `Create` uses `excludeContactedFromOtherCampaigns`, `excludeHasOtherAccConversations`, `excludeContactedFromSenderInOtherCampaign`). Treat the GetAll item shape as UNVERIFIED and parse both sets leniently.

### Campaign status enum

`DRAFT`, `IN_PROGRESS`, `PAUSED`, `FINISHED`, `CANCELED`, `FAILED`, `STARTING`, `SCHEDULED`. Meanings are not documented beyond the names. What the docs do say: `Create` makes a `DRAFT`; `StartCampaign` activates it; `UpdateSequence` is allowed only in `DRAFT`, `SCHEDULED`, `PAUSED`; a `SCHEDULED` campaign whose sequence is updated reverts to `DRAFT`. `GetCampaignsForLead` lists the same enum without `SCHEDULED`. Webhook payloads carry `campaign.status` as an **integer**; the number-to-name mapping is not documented.

There is no campaign type field, no schedule read endpoint (schedule is write-only via `UpdateSchedule`; confirmed again on 2026-11-14), and no "deleted" flag except `isCampaignDeleted` in per-campaign stats.

## 2. Sequence / steps

### `GET /campaign/GetCampaignSequence?campaignId=<long>`

Returns one **tree node** (not a step array), or an empty 200 body when the campaign has no sequence.

Node fields (`PublicSequenceNodeDto`):

- `nodeType`: `CONNECTION_REQUEST`, `MESSAGE`, `INMAIL`, `VIEW_PROFILE`, `FOLLOW`, `LIKE_POST`, `FIND_EMAIL`, `CHECK_IS_CONNECTION`, `CHECK_IS_OPEN_PROFILE`, `SEND_LEAD_TO_INSTANTLY`, `SEND_LEAD_TO_SMARTLEAD`, `SEND_LEAD_TO_BISON`, `END`. The `START` node is implicit and never returned.
- `actionDelay` (int 0-100) + `actionDelayUnit` (`HOUR` | `DAY`): wait **before** this node runs.
- `payload`: shape depends on `nodeType`.
- `unconditionalNode`: next node (or the "false" branch).
- `conditionalNode`: the "true" branch. Branching nodes: `CONNECTION_REQUEST` (accepted), `CHECK_IS_CONNECTION`, `CHECK_IS_OPEN_PROFILE`, `FIND_EMAIL`. In the V2 docs, on `MESSAGE`/`INMAIL` it is "the `END` node taken when the lead replies".
- `externalReference` (string, max 100): caller's own step id; "returned via API and webhooks"; omitted when unset.

Documented payloads:

- `CONNECTION_REQUEST`: `{ messages: string[], fallbackMessage: string, toBeWithdrawnAfterDays: int }`
- `MESSAGE` (v1): `{ messages: string[], fallbackMessage: string }`. `messages` holds the A/B variants.
- `SEND_LEAD_TO_INSTANTLY`: `{ instantlyResourceId, resourceType: LIST|CAMPAIGN, removeExternalLead? }`
- `SEND_LEAD_TO_SMARTLEAD`: `{ smartLeadCampaignId, pauseExternalLead }`
- `SEND_LEAD_TO_BISON`: `{ bisonCampaignId?, stopExternalLead }`
- `INMAIL`, `LIKE_POST`: payload required but **schema not documented** (so the InMail subject field name is unknown).
- No payload: `VIEW_PROFILE`, `FOLLOW`, `FIND_EMAIL`, `CHECK_IS_CONNECTION`, `CHECK_IS_OPEN_PROFILE`, `END`.

Variables seen in examples: `{FIRST_NAME}`, `{LAST_NAME}`, `{MY_FIRST_NAME}`, `{MY_LAST_NAME}` (single braces).

### `GET /campaign/GetCampaignSequenceV2?campaignId=<long>` (docs.heyreach.io only)

Same tree, but a `MESSAGE` payload is `{ messageVersions: [...], fallbackMessage }`. Each version: `message`, `type` (`TEXT` | `VOICE`), `voiceMode` (`DYNAMIC` | `STATIC`), `messageId`, `staticClipId`, `durationMs`, `transcript`, `staticClipTranscript`, `importedTranscript`, `needsRecording`. Use V2 for campaigns with voice notes.

Errors: `404 CAMPAIGN_NOT_FOUND`; `404 CAMPAIGN_API_NOT_ENABLED` ("the campaign API is not enabled for your account") — so sequence reads can be gated per account.

There are no per-step ids in v1 (only optional `externalReference`), and no email-style subject/body steps.

## 3. Senders (LinkedIn accounts)

### `POST /li_account/GetAll` (POST-for-read) — body `{ offset, limit (max 100), keyword }` → `{ totalCount, items }`

### `GET /li_account/GetById?accountId=<int>` → bare object, same fields

Fields: `id`, `emailAddress`, `firstName`, `lastName`, `isActive`, `activeCampaigns`, `authIsValid`, `isValidNavigator`, `isValidRecruiter`, `profileUrl`, `searchCooldown`, `connectionRequestCooldown`, `connectionNoteCooldown`, `inMailCooldown`, and `accountLimits`: `followLimit`/`followLimitMax`, `messageLimit`/`messageLimitMax`, `inMailLimit`/`inMailLimitMax`, `profileViewLimit`/`profileViewLimitMax`, `postLikeLimit`/`postLikeLimitMax`, `connectioRequestLimit`/`connectioRequestMax` (**sic**: misspelled, and the max has no `Limit` in its name).

The docs do not say whether a limit pair is per day or what `Limit` vs `Max` mean (likely a daily range). No warmup fields exist. Status is booleans (`isActive`, `authIsValid`, plus the cooldown flags), not an enum.

### `GET /li_account/GetAccountStatus/{accountId}` → `{ accountId, status, failureReason, profile{fullName,email,profileUrl}, salesNavigator{authenticated}, recruiter{authenticated} }`

Cached 10 seconds. Only the `status` value `Disconnected` appears in docs; the full enum is not documented.

### `POST /MyNetwork/GetMyNetworkForSender` — body `{ senderId, pageNumber, pageSize }` (page-number pagination, the only endpoint that uses it)

## 4. Leads

There is **no global "list all leads" endpoint**. Leads are reached through a list or a campaign.

### Per list — `POST /list/GetLeadsFromList` (POST-for-read)

Body: `listId` (required), `offset`, `limit` (**max 1000**), `keyword`, `leadProfileUrl`, `leadLinkedInId`, `createdFrom`, `createdTo` (ISO 8601, offsets allowed). Item: `profileUrl`, `firstName`, `lastName`, `headline`, `imageUrl`, `location`, `companyName`, `companyUrl`, `position`, `about`, `connections`, `followers`, `tags` (string[]), `emailAddress`, `customFields` (`[{ name, value }]`). No lead id and no status in this shape. The help center says auto-tag data was added to this endpoint; the field names are not in the API docs.

### Per campaign — `POST /campaign/GetLeadsFromCampaign` (POST-for-read)

Body: `campaignId` (required), `offset`, `limit` (max 100), `timeFrom`, `timeTo`, `timeFilter` (`Everywhere` default, `CreationTime`, `LastActionTakenTime`, `FailedTime`, `LastActionTakenOrFailedTime`). Item: `id`, `linkedInUserProfileId`, `linkedInUserProfile { linkedin_id, profileUrl, firstName, lastName, headline, imageUrl, location, companyName, companyUrl, position, about, connections, followers, emailAddress }`, `lastActionTime`, `failedTime`, `creationTime`, `leadCampaignStatus`, `leadConnectionStatus`, `leadMessageStatus`, `errorCode`, `leadCampaignStatusMessage`, `linkedInSenderId`, `linkedInSenderFullName`.

Enums:

- `leadCampaignStatus`: `Pending`, `InSequence`, `Finished`, `Paused`, `Failed` (`GetCampaignsForLead.leadStatus` adds `Excluded`, `PendingOrExcludedToBeCalculated`)
- `leadConnectionStatus`: `None`, `ConnectionSent`, `ConnectionAccepted`
- `leadMessageStatus`: `None`, `MessageSent`, `MessageReply`
- `leadCampaignStatusMessage`: usually null; the failure reason when the lead is `Failed`.

Caveat from the docs: it "shows only the Pending leads that are about to start executing actions"; more pending leads from the lead list may be inserted later, so `totalCount` can be lower than the list size. No custom fields in this shape. The MCP tool adds two voice-note filters (`messagesWithVoiceNotes`, `repliedToConversationWithVoiceNote`) that are not in the REST docs.

### Single lead — `POST /lead/GetLead` body `{ profileUrl }` (lookup by LinkedIn URL only)

Fields: `linkedin_id`, `imageUrl`, `firstName`, `lastName`, `fullName`, `location`, `summary`, `companyName`, `companyUrl`, `position`, `industry`, `about`, `username`, `emailAddress`, `connections`, `followers`, `experiences` (JSON **string**), `education` (JSON **string**), `profileUrl`, `enrichedEmailAddress`, `headline`, `emailEnrichments` (string[]).

### Related reads

- `POST /lead/GetTags` `{ profileUrl }` → `{ tags: string[] }` (sorted alphabetically)
- `POST /campaign/GetCampaignsForLead` `{ email?, linkedinId?, profileUrl?, offset, limit }` → `{ leadFullName, totalCount, items[{ campaignId, campaignName, campaignStatus, creationTime, leadStatus }] }`
- `POST /list/GetListsForLead` (same body) → `{ totalCount, items[{ listId, listName }] }`
- `POST /list/GetAll` `{ offset, limit (max 100), keyword, listType, campaignIds }`, `GET /list/GetById?listId=` → `id`, `name`, `totalItemsCount`, `listType` (`USER_LIST` | `COMPANY_LIST`), `creationTime`, `campaignIds`
- `POST /list/GetCompaniesFromList` (max 1000) → `name`, `description`, `industry`, `imageUrl`, `companySize`, `employeesOnLinkedIn`, `location`, `specialities`, `website`
- `POST /blacklist/GetLeads`, `POST /blacklist/GetCompanies` (limit 1-100, default 10; workspace-scoped)

Lead identity: the stable keys are `linkedin_id` (member id, string) and `profileUrl`. The snake_case `linkedin_id` sits inside otherwise camelCase objects. Custom fields are free-form `{ name, value }` pairs; names must be alphanumeric or underscore.

## 5. Messages

No "list messages" endpoint. Messages exist only inside conversations (section 6 endpoints), and **bodies are returned**.

Message fields (documented): `createdAt`, `body`, `subject`, `postLink`, `isInMail`, `sender`. `sender` is `"ME"` in examples; the value for the other party is not documented. The official MCP tool descriptions add that every message also has `type` (`text`, `voice_note`, `gif`, `attachment`, `post`, `other`), `isVoiceNote`, `transcript`, `transcriptStatus` (`PENDING`, `DONE`, `NO_SPEECH`, `FAILED`), `audioDurationMs`; and `GetVoiceMessageAudio` refers to a `messageId`. None of those appear in the REST response examples, so they are UNVERIFIED for REST.

There is no message-to-step link, no message id in the documented shape, and no delivery status.

## 6. Replies / conversations (the inbox)

### `POST /inbox/GetConversationsV2` (POST-for-read, offset paging)

Body `{ filters: { linkedInAccountIds, campaignIds, searchString, leadLinkedInId, leadProfileUrl, tags, seen }, offset, limit (max 100) }`. Returns `{ totalCount, items }`. Item: `id`, `read`, `groupChat`, `blockedByMe`, `blockedByParticipant`, `lastMessageAt`, `lastMessageText`, `lastMessageType` (`TEXT` shown), `lastMessageSender` (`ME` shown), `totalMessages`, `linkedInAccountId`, `correspondentProfile`, `linkedInAccount`, `messages[]`.

- `correspondentProfile`: `id`, `linkedin_id`, `profileUrl`, `firstName`, `lastName`, `headline`, `imageUrl`, `location`, `companyName`, `companyUrl`, `position`, `about`, `connections`, `followers`, `tags`, `emailAddress`, `customFields`. The V3 docs state the email keys were "already always null" on V2.
- `linkedInAccount`: `id`, `emailAddress`, `firstName`, `lastName`, `authIsValid`, `isValidNavigator`, `isValidRecruiter`, `profileUrl`.
- V2 has a "deep-paging limit ... on large inboxes" (number not given) and no date filter.

### `POST /inbox/GetConversationsV3` (POST-for-read, **cursor** paging) — the documented successor

Body `{ limit (1-100, default 10), cursor, from, to, filters{ ...V2 filters, latestAutoTagNames } }`. `from`/`to` bound `lastMessageAt` in UTC; `to` defaults to now. Sort: `lastMessageAt` desc, then `linkedInAccountId` asc. Returns `{ items, totalCount, nextCursor, hasNextPage }`; `nextCursor` is null on the last page. Differences from V2: item has `campaignId` (omitted when not tied to a campaign); `correspondentProfile` drops `emailAddress`/`customFields` and adds `autoTags[{ name, campaignId, campaignName, linkedInAccountId, linkedInAccountFullName, creationTime }]`. Documented 400 messages include `Invalid cursor format.` and `From must not be later than To`. V3 is **not** in the official MCP tool list (MCP still exposes `get_conversations_v2`).

### `GET /inbox/GetChatroom/{accountId}/{conversationId}`

One conversation with all messages. Same shape as a V2 item, minus `lastMessageType` and minus `correspondentProfile.id`/`linkedin_id` in the documented example. `accountId` is the sender's id (`linkedInAccountId` of the conversation).

Whether the `messages[]` embedded in a V2/V3 list item is the full thread or a recent subset is not stated.

### Reply classification

- No sentiment/category field on messages.
- "Auto-Tag" classifies a lead from its **first campaign reply**, 15 minutes after it arrives, into one of three tags named in the help center: **Interested**, **Not Interested**, **Generic**. One auto-tag per lead per workspace; the newest wins. Replies outside a campaign are never tagged.
- Exposed via `correspondentProfile.autoTags[].name` (V3), the `latestAutoTagNames` filter, and webhook events. The exact `name` strings returned by the API are not listed in the API docs (UNVERIFIED).
- Manual lead `tags` (free text, workspace-defined) are separate.
- Simple reply detection without tags: `leadMessageStatus == "MessageReply"` on campaign leads, or `lastMessageSender != "ME"` on conversations.

## 7. Analytics

### `POST /stats/GetOverallStats` (POST-for-read)

Body `{ accountIds: int[], campaignIds: int[], startDate, endDate }` (empty arrays = all). Dates ISO 8601 UTC. The MCP tool says start and end must both be given or both omitted (omitted = all time). Response:

```
{ "byDayStats": { "2024-12-17T00:00:00Z": { ...stats }, ... }, "overallStats": { ...stats } }
```

`byDayStats` is an **object keyed by UTC-midnight ISO strings**, not an array.

Stat fields (exact): `profileViews`, `postLikes`, `follows`, `messagesSent`, `totalMessageStarted`, `totalMessageReplies`, `inmailMessagesSent`, `totalInmailStarted`, `totalInmailReplies`, `connectionsSent`, `connectionsAccepted`, `messageReplyRate`, `inMailReplyRate`, `connectionAcceptanceRate`. Rates are fractions 0-1 (e.g. `0.2236693`), not percentages. Note casing: `inmailMessagesSent` vs `inMailReplyRate`. `totalMessageStarted` / `totalInmailStarted` are not defined in the docs (probably conversations started).

### `POST /stats/GetOverallStatsByCampaign` (POST-for-read)

Same body. `byDayStats[day]` and `overallStats` are **arrays** of the same stat object plus `campaignId`, `campaignName`, `isCampaignDeleted`.

Not available: per-step stats, a per-sender breakdown (call once per `accountIds: [id]` instead), opens, bounces, unsubscribes, delivered. Positive-reply counts: the help center says auto-tag data was added to both stats endpoints, but no such field is in the documented response (UNVERIFIED). Per-campaign lead funnel counts are also in `campaign.progressStats`.

## 8. Workspaces / clients and how keys map

- **Workspace API key**: created in the app under Integrations → HeyReach API. Scoped to one workspace. Never expires; can be deleted/deactivated. The blacklist docs say it plainly: "an API key only ever sees and changes its own workspace's entries." The intro's wording ("map them to your organization") is looser, but nothing lets a workspace key see another workspace. No workspace id parameter exists on the normal endpoints.
- Each workspace also has separate keys for n8n, Make, Zapier and MCP.
- **Organization API key** (docs also say "Master API Key"): found in Organization settings, organization Admins only. Works on `/api/public/management/organizations/*`:
  - `GET /management/organizations/workspaces?Offset=&Limit=` → `{ totalCount, items[{ workspaceId, workspaceName, seatsLimit, usedSeats }] }`
  - `GET /management/organizations/api-keys/workspaces/{workspaceId}` → `{ apiKeys: { publicApi, n8N, make, zapier, mcp } }`
  - `POST /management/organizations/linkedin-accounts` `{ keyword, workspaceIds, offset, limit }` → senders across workspaces with `workspaceId`, `workspaceName`
  - `POST /management/organizations/users`, `GET .../users/{userId}`, `POST .../users/workspaces/{workspaceId}`
- So an agency can be covered two ways: (a) one workspace key per client, supplied by the user; or (b) one organization key → list workspaces → fetch each workspace's `publicApi` key → call the normal API per workspace. Option (b) reads secrets and needs an admin key; whether `publicApi` is null when no key was generated is not stated.
- Whether an organization key is accepted on normal (non-management) endpoints is not stated (UNVERIFIED; assume no).
- `GetById` campaign returns `organizationUnitId`; probably the workspace id, not confirmed.
- The MCP server (`https://mcp.heyreach.io/mcp`) differs: OAuth sign-in connections span several workspaces and every tool takes `workspaceId` (`list_workspaces` exists only in MCP). MCP API keys (`X-MCP-KEY`) are single-workspace.

## 9. Webhooks

Registration (workspace API key):

- `POST /webhooks/CreateWebhook` `{ webhookName, webhookUrl, eventType, campaignIds }` (name 3-25 chars per MCP schema)
- `POST /webhooks/GetAllWebhooks` `{ offset, limit, includeCustomHeaders }` → `{ totalCount, items }` (POST-for-read)
- `GET /webhooks/GetWebhookById?webhookId=&includeCustomHeaders=`
- `PATCH /webhooks/UpdateWebhook?webhookId=`, `DELETE /webhooks/DeleteWebhook?webhookId=`
- Webhook object: `id`, `webhookName`, `webhookUrl`, `eventType`, `campaignIds`, `isActive`, `customHeaders[{ name, value }]`
- **One event type per webhook.** Subscribing to N events needs N webhooks (same URL is fine).
- `campaignIds: []` = all campaigns. Also creatable in the UI (Integrations → Webhooks).

Event types (`eventType`, upper snake):

| Value | Source | Notes |
| --- | --- | --- |
| `CONNECTION_REQUEST_SENT` | API docs |  |
| `CONNECTION_REQUEST_ACCEPTED` | API docs |  |
| `MESSAGE_SENT` | API docs |  |
| `MESSAGE_REPLY_RECEIVED` | API docs | first reply only |
| `INMAIL_SENT` | API docs |  |
| `INMAIL_REPLY_RECEIVED` | API docs | first reply only |
| `EVERY_MESSAGE_REPLY_RECEIVED` | API docs | every reply, messages and InMails |
| `FOLLOW_SENT`, `LIKED_POST`, `VIEWED_PROFILE` | API docs |  |
| `CAMPAIGN_COMPLETED` | API docs |  |
| `LEAD_TAG_UPDATED` | API docs |  |
| `VOICE_NOTE_RECEIVED` | docs.heyreach.io only | ignores `campaignIds` |
| `LEAD_FINISHED_SEQUENCE_WITHOUT_REPLYING` | MCP `create_webhook` enum only | not in REST docs |
| `LEAD_AUTO_TAGGED_INTERESTED`, `LEAD_AUTO_TAGGED_NOT_INTERESTED`, `LEAD_AUTO_TAGGED_GENERIC` | MCP enum only | help center calls them "Lead Auto Tagged Positive/Negative/Generic" |

Payload: HTTP POST, JSON, snake_case keys (unlike the camelCase REST API). `event_type` in the payload is the **lowercase** form (`voice_note_received`, `message_sent`).

Only `VOICE_NOTE_RECEIVED` has an official payload spec. Its top-level keys: `event_type`, `timestamp`, `correlation_id` (uuid), `conversation_id`, `is_inmail`, `recent_messages[]`, `sender`, `lead`, `campaign`, `external_reference`.

- `recent_messages[]`: `creation_time`, `message`, `is_reply`, optional `message_type` (`Voice`, `Gif`, `Attachment`, `Post`; absent for text), optional `voice_note { transcript, transcript_status }`.
- `sender`: `id` (LinkedIn account id), `first_name`, `last_name`, `full_name`, `email_address`, `profile_url`.
- `lead`: `id` (LinkedIn member id, string), `profile_url`, `first_name`, `last_name`, `full_name`, `location`, `summary`, `company_url`, `company_name`, `position`, `about`, `email_address`, `enriched_email`, `custom_email`, `tags[]`, `lists[{ name, id, custom_fields{} }]`.
- `campaign`: `name`, `id`, `status` (integer); present only when the conversation belongs to a campaign.

The docs confirm `MESSAGE_SENT`, `MESSAGE_REPLY_RECEIVED` and `EVERY_MESSAGE_REPLY_RECEIVED` also carry `recent_messages` (with the optional voice fields) and that the InMail events do not carry the voice fields. A third-party sample of `message_sent` shows the same `event_type`/`correlation_id`/`timestamp`/`sender`/`lead`/ `campaign`/`recent_messages` skeleton. The other events' payloads are undocumented; it is reasonable to expect the same skeleton, but that is an inference.

Signature / verification: **none documented.** No HMAC header, no signing secret, no timestamp header. The only mechanism visible is `customHeaders` on the webhook object (a static shared-secret header). `CreateWebhook`'s documented body has no `customHeaders` field, so how they are set through the API is unclear (UI, or an undocumented field). Retry policy, timeouts and delivery ordering are not documented. `correlation_id` is the only dedupe key.

Plan gating: none documented for webhooks. Elsewhere: MCP needs "a plan that includes MCP access"; sequence reads can return `CAMPAIGN_API_NOT_ENABLED`; voice endpoints return 403 `NO_ACTIVE_SUBSCRIPTION` / `VOICE_NOTES_NOT_ENABLED`; account `Connect` "requires the Account Login API feature".

## 10. Whoami / key check

`GET /auth/CheckApiKey` → `200` with an empty body when the key is valid. It returns **no identity** (no workspace id or name, no organization). There is no whoami. With a workspace key, the workspace cannot be named through the API; `organizationUnitId` on a campaign is the only hint.

## Account-level reads (added 2026-11-14)

Sources for this section: `https://docs.heyreach.io/openapi.json` and `https://docs.heyreach.io/llms.txt` fetched again on 2026-11-14 (both unchanged from the copies used above), the pages `https://docs.heyreach.io/hey-reach-api/stats/get-overall-stats.md` and `https://docs.heyreach.io/hey-reach-api/linked-in-accounts/get-by-id.md`, the help article `https://help.heyreach.io/en/articles/14997865-unified-email-column-how-email-is-managed-on-leads.md`, and read-only requests to one live workspace with a workspace API key. "Seen live" below means a field name or type observed in those requests. No response was saved and no value was copied into this repository.

### Lead lists: `lists.list`

`POST /list/GetAll` with `{ offset, limit }` (limit up to 100; 101 is refused on the endpoints tried). Returns `{ totalCount, items }`. Fields used: `id`, `name`, `totalItemsCount` (size), `listType` (`COMPANY_LIST` is `companies`, anything else `leads`), `creationTime`. `campaignIds` stays in raw. Seen live for `USER_LIST`. Unconfirmed: the `COMPANY_LIST` value (documented, no company list existed live).

### A list's leads: `lists.leads`

`POST /list/GetLeadsFromList` with `{ listId, offset, limit, createdFrom, createdTo }`, up to 1000 rows a page (1000 returned 256 of 256 live). Fields used: `profileUrl` (the lead's id, as in the other lead reads), `firstName`, `lastName`, `companyName`, `position`, `emailAddress`, `enrichedEmailAddress`, `customEmailAddress`, `tags` (array of names), `customFields` (`[{ name, value }]`), `autoTags[{ name, creationTime, campaignId, ... }]`. The newest auto-tag's `name` is the lead's `interest`; the names seen live were `Interested`, `Not interested` and `Generic`. `createdFrom` in the future returned no rows, so the date filter works on the server. A missing list is a 404. Unconfirmed: a row has no status, no campaign and no creation time; whether `GetLeadsFromList` answers for a company list (companies are read with `POST /list/GetCompaniesFromList`, which the adapter does not map because a company is not a lead); which of the three email fields is the newest (the help center says the app shows "the most recent", the API does not say).

### One lead's tags (fills `Lead.tags` on `leads.get`)

`POST /lead/GetTags` with `{ profileUrl }` returns `{ tags: string[] }`, sorted. `POST /lead/GetLead` carries no tags, so `leads.get` sends both requests. Seen live with an empty array.

### Block list: `blocklist`

`POST /blacklist/GetLeads` then `POST /blacklist/GetCompanies`, each with `{ offset, limit }` (1 to 100), newest first, `{ totalCount, items }`. Lead fields used: `id`, `profileUrl`, `email`, `fullName`, `creationTime`. Company fields used: `id`, `companyName`, `linkedInUrl`, `creationTime`. The two lists are numbered separately (both had an id 1 in the documented examples), so the record id is `lead-<id>` or `company-<id>`. `matchingStatus` (`Matching`, `Matched`, `NotFound`, `BroadMatch`) and `resolutionStage` stay in raw. The company shape was seen live; the lead shape is from the API reference only (no blacklisted lead existed live).

### Webhook subscriptions: `webhooks.list`

`POST /webhooks/GetAllWebhooks` with `{ offset, limit, includeCustomHeaders: false }` (limit up to 100). Fields used: `id`, `webhookName`, `webhookUrl`, `eventType` (one per webhook), `isActive`, `campaignIds` (empty means every campaign). Custom headers are never requested: they are where a shared secret lives. There is no creation time. The endpoint has no campaign filter, so a campaign filter is applied after fetching. Unconfirmed: the whole item shape (API reference only; the live workspace had no webhook and returned `{ totalCount: 0, items: [] }`).

### Sender health: `senders.health`

`GET /li_account/GetAccountStatus/{accountId}` returns `{ accountId, status, failureReason, profile, salesNavigator, recruiter }`, cached for 10 seconds. Fields used: `status` (`Connected` seen live, `Disconnected` documented; any other value maps to `connected: null`) and `failureReason` (the one issue). A LinkedIn seat has no domain, DNS, block list or warmup, so those are null, and no check time is given. Unconfirmed: the full `status` enum.

### A campaign's senders: `senders.byCampaign`

`GET /campaign/GetById` returns `campaignAccountIds` (seen live, also on `POST /campaign/GetAll` items). There is no account-by-campaign endpoint, and `POST /li_account/GetAll` ignored a `campaignIds` filter when tried, so the adapter reads the campaign once and narrows `POST /li_account/GetAll` pages to those ids. Cost: one request for the campaign, then one per page of 100 workspace accounts.

### One conversation: `messages.byThread`

`GET /inbox/GetChatroom/{accountId}/{conversationId}` returns one conversation in the same shape as a `GetConversationsV2` item, with every message, oldest first (13 of 13 live). It needs the LinkedIn account id as well as the conversation id, so a message's `threadId` is now `<accountId>:<conversationId>`. Conversation ids seen live hold letters, digits, `-` and `=`. An unknown conversation is a 404 with `{ errorMessage }`. A chatroom does not name its campaign.

### Sequences as a tree

Nine layouts were read from 18 live campaigns: `CHECK_IS_CONNECTION` at the root with messages on the connected branch and either `END` or a `CONNECTION_REQUEST` path on the other; `CONNECTION_REQUEST` at the root with messages on the accepted branch and `END` or a `VIEW_PROFILE` on the not-accepted branch; a plain run of messages; an empty sequence. A `MESSAGE` node's `conditionalNode` was always `END`. A `VIEW_PROFILE` node had a null `conditionalNode`. A `CHECK_IS_CONNECTION` node carried its own `actionDelay` (7 days in one campaign). `MESSAGE` payloads also carry `hasVoiceNotes`. Unconfirmed: `FIND_EMAIL` and `CHECK_IS_OPEN_PROFILE` branches (documented, not seen), `INMAIL` and `LIKE_POST` payloads.

### Stats fields the API reference does not list

Seen live on `POST /stats/GetOverallStats` and `GetOverallStatsByCampaign`: `uniqueLeadsContacted`, `autoTaggedInterested`, `totalAutoTagged`, `autoTaggedInterestedRate`, `voiceNotesSent`, `voiceNoteConversations`, `repliedToVoiceNotes`, `voiceNoteReplyRate`. The adapter reads `uniqueLeadsContacted` as `contacted` and `autoTaggedInterested` as `positive`. The help center says auto-tag data was added to the stats endpoints; the API reference has not caught up.

### Other fields seen live that the API reference does not list

- Campaign: `excludeFromLeadBlacklist`, `excludeFromCompanyBlacklist`, `startedAt`. The list item has the same fields as `GetById`, so the "stale `exclude*` names" in section 1 are a documentation error.
- Campaign lead: `finishedTime`, and `enrichedEmailAddress` and `customEmailAddress` on the profile.
- Message: `messageId`, `type`, `isVoiceNote`, `transcript`, `transcriptStatus`, `audioDurationMs`. The adapter still builds a message's id from the conversation, time, side and text, so ids already handed out do not change; switching to `messageId` is a breaking change left for later.
- Conversation profile: `tags`, `autoTags`, `customFields`.

### Not available from the API

- **Campaign settings (`campaigns.settings`).** `GET /campaign/GetById` returns no schedule, start or end date, daily limit or stop rule. The schedule exists only as a write (`POST /campaign/UpdateSchedule`: `dailyStartTime`, `dailyEndTime`, `timeZoneId`, `enabledMonday` to `enabledSunday`, `startDate`, `endDate`). Sending limits belong to the LinkedIn account (`accountLimits`). `startedAt` is when the campaign was started, not a scheduled start date, so it is not mapped.
- **Subsequences (`sequence.subsequences`).** A campaign has one sequence tree and nothing else.
- **Tags (`tags`).** `POST /lead_tags/CreateTags` creates tags (`displayName`, `color`) and `POST /lead/GetTags` reads one lead's tags. No endpoint lists the workspace's tags, and a tag has no id.
- **Every lead (`leads.list`).** No endpoint lists all leads. Walking every list is not a correct substitute: a lead in several lists repeats, list rows carry no campaign or status, and nothing says a lead always stays in a list.
- **Lead engagement (`leads.engagement`).** No lead shape has open, click or reply counts. A campaign lead has `lastActionTime`, `leadConnectionStatus` and `leadMessageStatus`, which stay in raw.
- **Reply categories (`replies.category`).** The auto-tag is stored on the lead (`autoTags`), with a campaign and a time but no link to a message.
- **Step stats (`stats.byStep`).** Stats are by workspace, campaign, account and day only.
- **Warmup (`senders.warmup`).** LinkedIn accounts have none.
- **Workspaces (`workspaces`).** `GET /management/organizations/workspaces` answered 401 to a workspace key; it needs an organization key, which the normal endpoints are not documented to accept.
- **A sender's daily limit.** `accountLimits` holds six `Limit`/`Max` pairs and the docs still do not say which are daily or what the two numbers mean.
- **Campaign tags.** A campaign has none.

## Rate limits

- "HeyReach allows a maximum of `300` requests per minute. All requests are attributed to the same limit."
- "The Organization API has a separate rate limit of `300` requests per minute."
- Over the limit → HTTP 429 "and an error". Documented 429 body: `{ type, title, status, detail, instance }`.
- No rate-limit headers and no `Retry-After` are documented.
- Scope (per key / per workspace / per organization) is not stated. A third-party article says organization-wide. The MCP docs say sign-in connections "share one rate limit per workspace".
- Whether the workspace's n8n/Make/Zapier/MCP keys draw on the same 300/min budget as the public API key is not stated, so the budget an SDK really gets is unknown.

## Errors

| Status | Body |
| --- | --- |
| 400 | `{ "errorMessage": "..." }`, sometimes with `"errorCode"` (e.g. `PAGING_OUT_OF_RANGE`). Organization endpoints use problem-details instead. |
| 401 | Documented as problem-details JSON. **Observed** with no key: plain text `Missing API key`, no content-type. |
| 403 | `{ errorMessage, errorCode }` (voice / subscription gating) |
| 404 | `{ "errorMessage": "..." }`, sometimes `errorCode` (`CAMPAIGN_NOT_FOUND`, `CAMPAIGN_API_NOT_ENABLED`) |
| 429 | problem-details `{ type, title, status, detail, instance }` |

The stray keys `ut8c`, `laborum__e5`, `occaecat100` in documented error bodies are Postman mock noise. Parse errors defensively: JSON `errorMessage`, else problem-details `detail`/`title`, else raw text.

## Changelog highlights

HeyReach publishes no API changelog. Inferred from differences between the two doc sets and from dated examples (all UNVERIFIED as to exact dates):

- `GetConversationsV3` (cursor paging, `from`/`to`, `autoTags`) — examples dated July 2026.
- Blacklist endpoints (`/blacklist/*`) — examples dated September 2026.
- Voice notes: `/voice/*`, `GetVoiceMessageAudio`, `CreateV2`/`UpdateSequenceV2`/`GetCampaignSequenceV2`, `VOICE_NOTE_RECEIVED` — examples dated November 2026; not yet in the Postman collection.
- `GetOverallStatsByCampaign`, Enrichment (`/enrichment/enrich-email`), Organization → LinkedIn Accounts, account connect/proxy endpoints, campaign create/update endpoints.
- Auto-Tag (fields + three webhook events) and the unified email column (help center articles).
- MCP: OAuth sign-in with multi-workspace selection and `list_workspaces` at `https://mcp.heyreach.io/mcp`.
- Postman collection `publishDate`: 2026-09-16.

## Unverified / unclear

1. Rate-limit scope (key vs workspace vs organization), 429 headers, `Retry-After`.
2. `GetAll` campaign item field names (list schema and GetById example disagree on the `exclude*` fields; whether the list returns `organizationUnitId` and the two extra `progressStats` counters).
3. Default `limit` (10 per MCP schemas) and whether an over-max limit is clamped or rejected (`PAGING_OUT_OF_RANGE` is documented only on voice endpoints). Max for `GetLeadsFromCampaign`, `GetAllWebhooks`, org lists.
4. V2 conversations deep-paging ceiling; whether list items carry the full `messages[]` thread.
5. Message `sender` value for the lead side; whether REST returns `type`/`messageId`/voice fields.
6. Auto-tag `name` strings in the API; auto-tag fields in `GetLeadsFromList`, `GetChatroom`, stats.
7. Webhook payloads for every event except `voice_note_received`; integer `campaign.status` mapping; retries; signing (none found); how `customHeaders` are set via API.
8. Whether `LEAD_FINISHED_SEQUENCE_WITHOUT_REPLYING` and `LEAD_AUTO_TAGGED_*` are accepted by REST `CreateWebhook`.
9. `INMAIL` and `LIKE_POST` sequence payload schemas; meaning of `accountLimits` `Limit` vs `Max`.
10. `GetAccountStatus.status` enum; meanings of campaign statuses; `totalMessageStarted` definition.
11. Whether the organization key works on normal endpoints; what `organizationUnitId` is.
12. Stats date semantics: which timezone buckets days (keys are UTC midnight), inclusivity of `endDate`.
13. Plan gating for the public API as a whole (not stated on the docs site).
14. OpenAPI types are unreliable (generated from placeholder examples).

## Sources (all fetched 2026-11-14)

- https://docs.heyreach.io/llms.txt (and /llms-full.txt, identical) — saved as `sources/docs-llms.txt`
- https://docs.heyreach.io/openapi.json — saved as `sources/openapi.json`
- https://docs.heyreach.io/hey-reach-api.md — saved as `sources/api-overview.md`
- https://docs.heyreach.io/hey-reach-api/authentication.md
- https://docs.heyreach.io/hey-reach-api/organization.md — saved as `sources/organization-overview.md`
- https://docs.heyreach.io/hey-reach-api/inbox.md, /campaigns.md
- https://docs.heyreach.io/mcp/mcp-connector.md — saved as `sources/mcp-connector.md`
- https://docs.heyreach.io/hey-reach-api/webhooks/create-webhook (read via the OpenAPI description)
- https://documenter.getpostman.com/view/23808049/2sA2xb5F75
- https://documenter.getpostman.com/api/collections/23808049/2sA2xb5F75?segregateAuth=true&versionTag=latest — saved as `sources/postman-collection.json`
- https://help.heyreach.io/llms.txt — saved as `sources/help-llms.txt`; https://help.heyreach.io/sitemap.xml
- https://help.heyreach.io/en/articles/9877965-webhooks.md — saved as `sources/help-webhooks.md`
- https://help.heyreach.io/en/articles/14957953-auto-tag-automatic-lead-classification-in-heyreach.md — saved as `sources/help-auto-tag.md`
- https://help.heyreach.io/en/articles/14997865-unified-email-column-how-email-is-managed-on-leads.md
- https://help.heyreach.io/en/articles/12117291-how-does-heyreach-mcp-work-with-popular-tools.md
- https://help.heyreach.io/en/articles/12504692-how-to-integrate-heyreach-with-n8n.md
- https://help.heyreach.io/en/articles/11981678-master-view-every-workspace-one-screen-total-control.md
- https://www.heyreach.io/llms.txt
- Official HeyReach MCP tool schemas (`create_webhook`, `get_conversations_v2`, `get_chatroom`, `get_overall_stats`, `get_all_campaigns`, `get_leads_from_campaign`, `get_all_linked_in_accounts`, `list_workspaces`) — schemas read only, no tool called
- https://api.heyreach.io/api/public/auth/CheckApiKey — one request with no key (401 shape)
- https://api.heyreach.io/swagger, /swagger/v1/swagger.json, /openapi.json, /api-docs — no public Swagger (redirect loops / 404)
- Third party (not authoritative): https://outreachmagic.io/docs/heyreach-integration (sample `message_sent` payload), https://www.scalekit.com/blog/heyreach-mcp-vs-api (rate-limit scope claim), https://attio.com/apps/hey-reach (search excerpt)

## Inventory and native catalog (2026-11-14)

Fetched fresh for the inventory in `site/content/docs/coverage/heyreach.mdx`:

- https://docs.heyreach.io/llms.txt (the page index: 106 endpoint pages)
- https://docs.heyreach.io/openapi.json (106 operations on 105 paths; byte-identical to the copy read earlier the same day)
- https://docs.heyreach.io/hey-reach-api.md and https://docs.heyreach.io/hey-reach-api/organization.md
- https://documenter.getpostman.com/api/collections/23808049/2sA2xb5F75?segregateAuth=true&versionTag=latest (publishDate 2026-09-16; 88 requests, all of them also in the OpenAPI file, which has 18 more)

HeyReach documents no sister service on another host. The Organization Management API is on the same host under `/management/organizations`, takes the organization API key in the same `X-API-KEY` header, and has "a separate rate limit of 300 requests per minute" (organization.md).

Read-only requests to one live workspace on 2026-11-14, with a workspace key. Nothing from a response is recorded here beyond counts, key names and status codes.

| Read | Answer |
| --- | --- |
| `GET /auth/CheckApiKey` | 200, empty body |
| `GET /list/GetById` | 200. Keys: `id`, `name`, `listType`, `totalItemsCount`, `creationTime`, `campaignIds` |
| `POST /campaign/GetCampaignsForLead` | 200 `{ leadFullName, totalCount, items }`. `offset` and `limit` may be left out |
| `POST /list/GetListsForLead` | 404 for a lead that is in no list |
| `POST /MyNetwork/GetMyNetworkForSender` | 200 `{ totalCount, items }`. `pageNumber` and `pageSize` may be left out (20 rows came back); `pageSize` 1000 is refused with 400 |
| `POST /MyNetwork/IsConnection` | 200 `{ isConnection }`, with `leadProfileUrl` or with `leadLinkedInId` |
| `GET /campaign/GetCampaignSequenceV2` | 200, a node tree |
| `POST /stats/GetOverallStatsByCampaign` | 200 `{ byDayStats, overallStats }`, `overallStats` an array. An empty body is refused with 400: `accountIds` and `campaignIds` must be sent, as empty arrays if need be |
| `GET /li_account/GetProxyCountries` | 200, an array of objects |
| `GET /voice/GetVoices`, `GetStaticClips`, `GetElevenLabsConnection`, `GetElevenLabsVoices`, `GetVoiceUsage/{id}` | 200 |
| `GET /voice/GetSenderVoice/{accountId}` | 404 `SENDER_VOICE_NOT_ASSIGNED` |
| `GET /voice/GetStaticClip/{clipId}` | 404 `STATIC_CLIP_NOT_FOUND` |
| `GET /webhooks/GetWebhookById`, `GET /enrichment/enrich-email/check-job/{jobId}` | 404 for an id that does not exist (the workspace has no webhooks or enrichment jobs) |
| `POST /list/GetCompaniesFromList` | 400 for a lead list (the workspace has no company list) |
| `/management/organizations/workspaces`, `/users`, `/linkedin-accounts` | 401 with a workspace key |

Not requested: `GET /li_account/GetAccountProxy/{accountId}` and `GET /management/organizations/api-keys/workspaces/{workspaceId}` (both return secrets), and `GET /inbox/GetVoiceMessageAudio/...` (a binary file).

### `POST /inbox/GetConversationsV3`, now the listing the adapter reads

- Envelope: `{ items, totalCount, hasNextPage, nextCursor }`. `nextCursor` is a string and is `null` on the last page. Items are ordered newest `lastMessageAt` first. 257 conversations were read in three pages of 100, matching `totalCount` and the V2 `totalCount`.
- An item has the same keys as a V2 item. `correspondentProfile` lacks `emailAddress`, `enrichedEmailAddress`, `customEmailAddress` and `customFields`, as documented.
- A message has `body`, `createdAt`, `sender`, `subject`, `isInMail`, `postLink`, `messageId`, `type`, `isVoiceNote`, `transcript`, `transcriptStatus`, `audioDurationMs`.
- `from` and `to` bound `lastMessageAt` exactly: for bounds 1, 7 and 30 days before the newest conversation the rows returned were exactly the conversations at or after `from`, and `to` returned exactly those at or before it.
- In all 257 conversations `lastMessageAt` equalled the newest message's `createdAt`, and `messages.length` equalled `totalMessages` (the longest thread had 40).
- `filters.leadProfileUrl` returned only that lead's conversation. `limit` defaults to 10. A body with no `filters` key is accepted.
- Through the adapter: 827 messages with 827 distinct ids; a `since` at the 90th percentile and an `until` at the 10th each returned exactly the messages the unfiltered listing has in that range, and replies matched the inbound messages (302).

This closes open question 4 for V3 (cursor paging has no deep-paging ceiling, and list items carry the whole thread up to at least 40 messages) and question 5 (`type`, `messageId` and the voice fields are returned).

## Lookup by profile and by email: `leads.lookup` (2026-11-14)

Sources: `https://docs.heyreach.io/openapi.json` fetched again on 2026-11-14 (operations `campaigns_GetCampaignsForLead`, `leads_GetLead`, `lists_GetListsForLead`, `lists_GetLeadsFromList`), and read-only requests to one live workspace with a workspace API key. Nothing from a response is recorded here beyond counts, key names, enum values and status codes.

### What the reference documents

- `POST /campaign/GetCampaignsForLead` takes `email`, `linkedinId`, `profileUrl` (each optional), `offset` and `limit`, and returns `{ leadFullName, totalCount, items[{ campaignId, campaignName, campaignStatus, creationTime, leadStatus }] }`. `leadStatus` is `Pending`, `InSequence`, `Finished`, `Paused`, `Failed`, `Excluded` or `PendingOrExcludedToBeCalculated`. Only a 200 answer is documented.
- `POST /lead/GetLead` takes `profileUrl`, which is required, and returns the profile. No read returns a profile for an email address.
- `POST /list/GetListsForLead` takes the same three keys and returns `{ totalCount, items[{ listId, listName }] }`.
- `POST /list/GetLeadsFromList` takes `keyword` ("a search term to filter leads by name or other relevant fields") and `leadProfileUrl`.

### Seen live

- `GetCampaignsForLead` answered 200 with exactly the documented keys for a profile URL, for an email address and for a `linkedinId`. `campaignId` is an integer. An item's `creationTime` equalled the campaign's own `creationTime` from `POST /campaign/GetAll` and not the lead's row in that campaign, so it is not when the lead was added.
- With none of the three keys it answered 400 `Email, Linkedin Id or ProfileUrl must be specified.`
- A person HeyReach does not know: 404 `{ errorMessage: "There is no lead matching your search criteria" }`, from `GetCampaignsForLead` (by profile URL and by email), from `GetLead` and from `GetListsForLead`.
- `limit` must be between 1 and 100 (1000 is refused with 400). An `offset` past the end answered 200 with no items and the same `totalCount`. The lead was in one campaign, so a second page was not seen.
- Both `GetCampaignsForLead` and `GetLead` matched the stored profile for `http://`, no `www.`, a trailing slash and a query string, and answered 404 when the slug was sent in upper case. The stored slug was lowercase. An email address matched in either case.
- `GetLead` accepts nothing but `profileUrl`: with `email` or `linkedinId` alone it answered 400 `The ProfileUrl field is required.`
- `GetLead` returned `customEmailAddress`, which the reference does not list, and held the lead's address in `emailAddress` while the same lead's rows in `GetLeadsFromCampaign` and `GetLeadsFromList` had all three email keys null. No campaign or list row in the workspace (692 list rows and 159 campaign rows read) carried an address.
- `GetLeadsFromCampaign` ignores `keyword`, `leadProfileUrl`, `profileUrl`, `email`, `leadLinkedInId` and `searchString`: each returned the whole campaign. A campaign cannot be searched for one person.
- `GetLeadsFromList` with `keyword` set to the lead's full name, first name or last name returned that lead; with the email address it returned nothing; with `leadProfileUrl` it returned that lead alone.

### How the adapter looks a person up

By profile URL, two requests in parallel: `GetCampaignsForLead` and `GetLead`, both with `https://www.linkedin.com/in/<slug>`, the slug lowercased. The profile is kept only when its own URL has the same slug.

By email, four requests in the usual case: `GetCampaignsForLead` (which names the person), `GetListsForLead` for one list the address is in, `GetLeadsFromList` with the name as `keyword` (5 rows at most), then `GetLead` for each row until one profile carries the address in `emailAddress`, `enrichedEmailAddress`, `customEmailAddress` or `emailEnrichments`. A later page of campaigns carries the profile URL in its page marker and costs two requests.

Each campaign gives one record with that campaign's ref and the lead's status in it. A lead's id is its profile URL, which is the same in every campaign, so a person's records share one ref and differ by `campaignRef`; the SDK core tells looked-up records apart by campaign. A known person in no campaign is one record with no campaign.

### Not confirmed

- A person in more than one campaign, and so a second page, was not seen live.
- A known person in no campaign was not seen: whether `GetCampaignsForLead` then answers 200 with no items or 404 is not known, and both are read as no campaigns.
- Which of the email fields `GetCampaignsForLead` and `GetListsForLead` match on is not documented.
- How HeyReach stores a slug with upper-case or non-ASCII letters is not known.

## Load test, 2026-11-14

Hand-run once against one live workspace, read-only, from one process, with the default `share` of 0.5.

HeyReach enforces a burst limit its documentation does not mention. The 429 body reads "Too many requests. Limit is 15 requests per 2 second(s)", and it carried no `Retry-After` and no rate-limit headers. The documented limit is 300 requests a minute.

| 100 `campaigns.get` fired at once | Before the limit was declared | After |
| --- | --- | --- |
| Succeeded | 100 | 100 |
| Responses of 429 | 35, all recovered by retry | 0 |
| Time | 187 seconds | 33 seconds |

An earlier run of 200 at once saw 13 responses of 429, also all recovered. The adapter now declares both windows: 15 per 2 seconds and 300 per minute. These are single observations, not a benchmark, and whether the limit is per key, per workspace or per organization is still unknown.

## Read again on 2026-11-14 for field coverage and the derived reads

Source: `https://docs.heyreach.io/openapi.json`, fetched fresh (105 paths). Nothing here was run against a live workspace.

- **Every lead (`leads.list`).** Still no endpoint. The adapter now walks `POST /campaign/GetAll` (pages of 100) and reads each campaign with `POST /campaign/GetLeadsFromCampaign`, as the Smartlead adapter does for its per-campaign listing. This reverses the earlier note above: the objection there was to walking saved lists, whose rows carry no campaign or status. A lead in no campaign is never returned.
- **A sender's campaigns (`campaigns.bySender`).** `POST /campaign/GetAll` takes `accountIds` (integer array, required in the schema beside `offset`, `keyword`, `statuses` and `limit`). The adapter sends it only when a sender is named; the list without it was seen live to work.
- **Every campaign's stats (`stats.allCampaigns`).** `POST /stats/GetOverallStatsByCampaign`: "Same filters as GetOverallStats, but the response is grouped by campaign: both `byDayStats` and `overallStats` return a list of per-campaign stat objects (each carrying `campaignId`, `campaignName` and `isCampaignDeleted`)". Seen live earlier (section above): `overallStats` is an array and `accountIds` and `campaignIds` must be sent, as empty arrays if need be. The schema lists `startDate` and `endDate` as required; the adapter sends both or neither, as for `GetOverallStats`. Whether the endpoint accepts no dates was not seen.
- **Unread (`replies.unread`).** `POST /inbox/GetConversationsV3` takes `filters.seen`: "`true` for read conversations, `false` for unread, `null` for both". Each conversation carries `read` (boolean). The flag is the conversation's, not one message's.
- **Reply category.** `correspondentProfile.autoTags` is on a V3 conversation and `filters.latestAutoTagNames` filters "by the lead's most recent auto tag". The reference still does not list the tag names. The help center names Interested, Not Interested and Generic; "Not interested" was seen live with a lower-case i. The adapter matches the three names without case and maps them to positive, negative and neutral. It does not send `latestAutoTagNames`, because the exact strings the filter needs are not documented; the category filter is applied after fetching.
- **Lead fields.** `companyUrl` is the company's LinkedIn page in every documented example (`https://www.linkedin.com/company/...`), not a website. `location` is on every lead shape. No phone number and no company website are documented.
- **Per-campaign rows are synthesized.** The reference gives a schema for `GetOverallStatsByCampaign` and no example, so `fixtures/heyreach/getOverallStatsByCampaign.json` is built from the schema.
- **One list, one webhook (`lists.get`, `webhooks.get`).** `GET /list/GetById?listId=` returns `id`, `name`, `totalItemsCount`, `listType`, `creationTime` and `campaignIds`, the list item's fields. `GET /webhooks/GetWebhookById?webhookId=&includeCustomHeaders=` returns `id`, `webhookName`, `webhookUrl`, `eventType`, `campaignIds`, `isActive` and, when asked, `customHeaders`. The client always sends `includeCustomHeaders=false`.
