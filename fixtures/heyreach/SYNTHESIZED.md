# Fixture provenance (HeyReach), 2026-11-14

All personal data is replaced with fakes (Alex/Sam Example, person1@example.com, Example Co, example-person-N). No fixture was captured from a live authenticated API call. Only the fixtures the adapter's tests use are in this folder.

`*.page2.json` is the LAST page of the matching list fixture (totalCount 3: page 1 has 2 items, page 2 has 1). HeyReach returns no "next" marker on offset lists, so a last page looks like any other page; the adapter stops when offset + items.length >= totalCount.

## Documented example copied (structure verbatim, names faked)

- getCampaign.json: docs example for campaign GetById. `campaignAccountIds` was changed to two ids from the account fixtures (1101, 1103), and `excludeFromLeadBlacklist`, `excludeFromCompanyBlacklist` and `startedAt` were added because the live API returns them (2026-11-14).
- getCampaignSequence.json: docs example for GetCampaignSequence
- getLead.json: docs example for GetLead
- getOverallStats.json: docs example (numbers verbatim)
- webhook.voice_note_received.json: the only webhook payload HeyReach documents officially

## Documented example extended (docs show one item; items and a last page were added in the same shape)

- getLeadsFromCampaign.json, getLeadsFromCampaign.page2.json

## SYNTHESIZED from schema only (docs give type placeholders such as "<integer>", no real example)

- listCampaigns.json, listCampaigns.page2.json: list-item field names come from the GetAll schema, which differs from the GetById example (see docs/research/heyreach.md, "Unverified"). `status` values are from the documented enum.
- listLinkedInAccounts.json, listLinkedInAccounts.page2.json, getLinkedInAccount.json: all numbers invented
- getCampaignSequenceV2.json: built from the OpenAPI PublicSequenceNodeDtoV2 schema

## Not from HeyReach

- webhook.message_sent.THIRD_PARTY.json: anonymised sample published by a third party (outreachmagic.io docs), trimmed by them; NOT an official payload. The real payload very likely has more keys (compare webhook.voice_note_received.json).

## Seen live

- error.400.campaign-gone.json: the body, verbatim, of GetConversationsV3 filtered by a campaign that campaign/GetAll still lists but GetById answers 404 for (2026-11-23). A filter naming it among other campaigns answers the same.

## No fixture possible

- Webhook payloads for connection_request_sent, connection_request_accepted, message_reply_received, every_message_reply_received, inmail_sent, inmail_reply_received, follow_sent, liked_post, viewed_profile, campaign_completed and lead_tag_updated: HeyReach publishes neither a schema nor an example. Not invented here.

- `getConversations.json`, `getConversations.page2.json`: built by hand on 2026-11-14 to match the structure of live conversation listings (field names, types and the `ME` / `CORRESPONDENT` sender values were read from a real workspace), and reshaped the same day to the `POST /inbox/GetConversationsV3` envelope the adapter now reads: `hasNextPage` and `nextCursor` beside `items`, and no email or custom-field keys on `correspondentProfile`. Every value is made up, the cursor included; no real conversation is included.
- `getCampaignSequence.connectionCheck.json`: built by hand on 2026-11-14 to match the node layout of live campaigns (CHECK_IS_CONNECTION with the same messages on both branches). The message text is made up.

## Added 2026-11-14 for the account-level reads

Every file below was built by hand. Field names and types come from the API reference (docs.heyreach.io) and, where marked "seen live", from read-only requests to one real workspace on 2026-11-14. No value was copied from a response: names, URLs, companies, text, ids and times are all made up.

- `listLists.json`, `listLists.page2.json` (`POST /list/GetAll`): shape seen live. The `COMPANY_LIST` item is from the documented enum; the live workspace had no company list.
- `getLeadsFromList.json`, `getLeadsFromList.page2.json` (`POST /list/GetLeadsFromList`): shape seen live, including `id`, `linkedin_id`, `autoTags`, `enrichedEmailAddress` and `customEmailAddress`, which the API reference does not list. No live lead had a manual tag, so `tags` as an array of names is from the API reference.
- `getBlacklistLeads.json`, `getBlacklistLeads.page2.json` (`POST /blacklist/GetLeads`): from the API reference only; the live workspace had no blacklisted lead. The three items are the three ways an entry is made: a profile URL, an email, a name.
- `getBlacklistCompanies.json` (`POST /blacklist/GetCompanies`): shape seen live.
- `listWebhooks.json`, `listWebhooks.page2.json` (`POST /webhooks/GetAllWebhooks`): from the API reference only; the live workspace had no webhook. `customHeaders` is left out because the adapter asks for the list without them.
- `getAccountStatus.json` (`GET /li_account/GetAccountStatus/{accountId}`): shape seen live (`avatarUrl` is not in the API reference). `Disconnected` and a failure reason are from the docs; the live account was `Connected` with a null reason.
- `getLeadTags.json` (`POST /lead/GetTags`): the documented shape; live it returned an empty `tags` array.
- `getChatroom.json` (`GET /inbox/GetChatroom/{accountId}/{conversationId}`): the first conversation of `getConversations.json` with one more message. Live, a chatroom has the same shape as a conversation in the list.
- `getCampaignSequence.branching.json`: a made-up tree that uses every branching node at once. The `CHECK_IS_CONNECTION` and `CONNECTION_REQUEST` layouts, a `VIEW_PROFILE` on the not-accepted branch and a null `conditionalNode` were seen live; `CHECK_IS_OPEN_PROFILE`, `INMAIL` and `FOLLOW` are from the documented node types.

## Added 2026-11-14 for lookup by profile and by email

Built by hand. Field names and types were seen live in read-only requests to one real workspace on 2026-11-14 and agree with the API reference; every value is made up.

- `getCampaignsForLead.json`, `getCampaignsForLead.page2.json` (`POST /campaign/GetCampaignsForLead`): `{ leadFullName, totalCount, items }`, each item `campaignId` (integer), `campaignName`, `creationTime`, `campaignStatus`, `leadStatus`. Only the lead status `Finished` was seen live; `InSequence` and `Excluded` are from the documented enum. The live lead was in one campaign, so a second page was not seen.
- `getListsForLead.json` (`POST /list/GetListsForLead`): `{ totalCount, items }`, each item `listId` (integer) and `listName`. Seen live.

## Added 2026-11-14 for stats per campaign

- `getOverallStatsByCampaign.json` (`POST /stats/GetOverallStatsByCampaign`): built from the response schema in `openapi.json`, which has no example. Every count has its own value so a field read from the wrong key shows. The live fields the reference does not list (`uniqueLeadsContacted`, `autoTaggedInterested`) are left out.
- `getListById.json` (`GET /list/GetById`) and `getWebhookById.json` (`GET /webhooks/GetWebhookById`): the first item of `listLists.json` and of `listWebhooks.json`. The reference gives both reads the fields of a list item.

## Added 2026-11-16 for campaign conversations (OUT-124)

- `getConversations.json` and `getConversations.page2.json` gained `campaignId` on each conversation. They stand for campaign conversations, and `GetConversationsV3` documents `campaignId` on those.
- `getConversations.inbox.json` was built by hand in the `GetConversationsV3` shape. It holds one campaign conversation (with `campaignId`) and two that belong to no campaign (no `campaignId` key), a recruiter's message and an inbound pitch, each ending on the other person's message. That is the shape the 2026-11-16 stress test saw in a live inbox. Every value is made up.
