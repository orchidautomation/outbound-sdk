# Fixture provenance (HeyReach), 2026-11-14

All personal data is replaced with fakes (Alex/Sam Example, person1@example.com, Example Co, example-person-N). No fixture was captured from a live authenticated API call. Only the fixtures the adapter's tests use are in this folder.

`*.page2.json` is the LAST page of the matching list fixture (totalCount 3: page 1 has 2 items, page 2 has 1). HeyReach returns no "next" marker on offset lists, so a last page looks like any other page; the adapter stops when offset + items.length >= totalCount.

## Documented example copied (structure verbatim, names faked)

- getCampaign.json: docs example for campaign GetById
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

## No fixture possible

- Webhook payloads for connection_request_sent, connection_request_accepted, message_reply_received, every_message_reply_received, inmail_sent, inmail_reply_received, follow_sent, liked_post, viewed_profile, campaign_completed and lead_tag_updated: HeyReach publishes neither a schema nor an example. Not invented here.

- `getConversations.json`, `getConversations.page2.json`: built by hand on 2026-11-14 to match the structure of live `POST /inbox/GetConversationsV2` responses (field names, types and the `ME` / `CORRESPONDENT` sender values were read from a real workspace). Every value is made up; no real conversation is included.
- `getCampaignSequence.connectionCheck.json`: built by hand on 2026-11-14 to match the node layout of live campaigns (CHECK_IS_CONNECTION with the same messages on both branches). The message text is made up.
