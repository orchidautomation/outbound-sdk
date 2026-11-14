# Fixture provenance (Smartlead)

> Copied from the research working folder. This repository holds only the fixtures the tests use, so some files named below are not here.

## Changed after the research, for the tests

- `listAllLeadsActivities.json`, `listAllLeadsActivities.page2.json`: the synthesized extra rows repeated the first row's `stats_id` and `message_id` values. Each row now has its own (`12345` to `12347`, `<abc123@...>` to `<abc125@...>`, `<reply123@...>` to `<reply125@...>`), because a sent email and a reply are identified by them.
- `listInboxReplies.json`, `listInboxReplies.page2.json`: the synthesized extra items repeated `last_message.id`. Each item now has its own (`email_abc123` to `email_abc125`).
- `webhook.*.json`: every `secret_key` value is `redacted`. The documented examples show placeholder secrets, which the fixture check reads as credentials.

## Added for the account-level reads (2026-11-14)

| File | Source and what was synthesized |
| --- | --- |
| `getEmailAccountWarmupStats.json` | The older (Notion) shape. Its example is all zeros, so every count was given its own value. |
| `getEmailAccountWarmupStats.newdocs.json` | The newer example, with `total_sent`, `spam_count` and `reputation_score` changed so they differ from the older file. |
| `listLeadLists.json`, `listLeadLists.page2.json` | The documented example; the last page was added. |
| `listDomainBlockList.json`, `listDomainBlockList.page2.json` | The docs example has 1 entry; an address entry and the last page were added, with mixed case to test lowercasing. |
| `listEmailAccountTags.json` | The documented example of `GET /email-accounts/tags`. |
| `listLeadTags.json` | The documented example of `GET /crm/leads/tags`. |
| `listCampaignWebhooks.json` | The older example is one object; wrapped in an array and a second added. |
| `listCampaignWebhooks.newdocs.json` | The newer example, whose event names are not real ones. |
| `getInboxItem.json` | The documented example of `GET /master-inbox/{id}`, which looks hand-written. |
| `listInboxReplies.history.json` | Built from the "with message history" example, whose items are elided with `{...}`: the thread fields come from the first example, and a second inbound message and a `lead.id` were added. |
| `analyticsMailboxNameWiseHealth.json` | The docs example has 1 row; a second was added, and the first mailbox's address is in mixed case. |
| `getLeadByEmail.json` | The documented example of `GET /leads/?email=`, with a second campaign added whose `lead_category_id` is `null`. The campaign ids are those of `listCampaigns.json`. |
| `listCampaigns.subsequences.json` | `listCampaigns.json` plus three child campaigns (`parent_campaign_id` set): two of campaign 372 and one of another campaign. No documented example shows a child campaign. |

All personal data was replaced with fakes (`personN@example.com`, "Alex Example", "Example Co", `example.com`). No fixture comes from a live API call. Field names are copied from the docs.

Smartlead publishes two generations of docs that often disagree on the response envelope:

- **legacy** = the Notion "API Documentation [DEPRECATED]" and "Webhook Guide Updated" pages on help.smartlead.ai. Their examples look like real captured responses.
- **newdocs** = api.smartlead.ai (Mintlify). Some pages carry real-looking examples ("Actual from API"), many carry illustrative or placeholder ones (`{"ok": true, "data": []}`, `msg_1`, `"warmup_reputation": "excellent"`).

Naming convention: `X.json` is the shape judged best supported. `X.newdocs*.json` / `X.legacy.json` is the competing documented shape, kept verbatim in structure so the adapter can be tested against both. `X.page2.json` is the last page of a paginated list.

## Built or extended from a schema / field list (not a documented example)

| File | What was synthesized |
| --- | --- |
| `listCampaigns.json` | Docs example has 1 item; second item added with the same fields. |
| `getCampaign.json` | Legacy bare-object example, updated to the field set of the list endpoint (array `track_settings`, object `scheduler_cron_value`). The legacy example showed those two as strings. |
| `getCampaignSequences.json` | Legacy example is one sequence object; wrapped in an array and a second step added (the docs say "Response Format: array"). `seq_delay_details` is documented as a field but appears in no GET example, so it is not in the fixture. |
| `listEmailAccounts.json`, `listEmailAccounts.page2.json` | Docs example has 1 item; second item and the short last page added. Passwords replaced with `REDACTED`. |
| `listCampaignEmailAccounts.json` | Legacy example has 1 item; second added. |
| `listCampaignLeads.json`, `listCampaignLeads.page2.json` | Docs example has 1 item; extra items and the last page added. `total_leads` kept as a string as in the newer example (legacy shows a number). |
| `searchCampaignLeads.json`, `searchCampaignLeads.page2.json` | Docs example has 1 item; second item and last page added. |
| `getCampaignStatistics.json`, `getCampaignStatistics.page2.json` | Legacy example has 1 row; extra rows and last page added. |
| `listAllLeadsActivities.json`, `listAllLeadsActivities.page2.json` | Docs example has 1 item; second item and the `hasMore: false` page added. |
| `listInboxReplies.json`, `listInboxReplies.page2.json`, `listInboxSent.json` | Docs example has 1 item; extra items and last page added. The item shape itself looks illustrative in the docs. |
| `listUntrackedReplies.json` | Docs example has 1 item; second added. `body` / `attachments` omitted (docs show them as prose placeholders). |
| `listClients.json` | Legacy example, sanitized (2 items as documented). |
| `listCampaignWebhooks.json` | Legacy example is one object; wrapped in an array and a second added. |
| `analyticsCampaignOverallStats.json`, `analyticsClientOverallStats.json`, `analyticsMailboxNameWiseHealth.json` | Docs example has 1 row; second added. |
| `getLeadMessageHistory.json` | Legacy example, sanitized; message ids and `stats_id` values replaced with obvious fakes. |
| `webhook.LEAD_CATEGORY_UPDATED.json` | Docs example, sanitized; junk keys in `lead_data.custom_fields` (`"undefined"`, UUID keys) dropped. |
| `webhook.EMAIL_REPLY.threaded.json` | The docs example for threaded replies; `stats_thread_id` placed as documented. |
| `getLeadByEmail.notfound.json` | Documented as `{}` with HTTP 200. |
| `error.429.*.txt` | Literal message strings quoted in the help center / rate-limit guide. |

## Verbatim placeholders (docs give no real example)

`getCampaignLeadStatistics.json`, `getCampaignMailboxStatistics.json`, `getCampaignTopLevelAnalyticsByDate.json` are exactly what the docs show: `{"ok": true, "data": []}`. The real row shape is undocumented.

## Competing shapes kept for reference

`getCampaign.newdocs.json`, `getCampaignSequences.newdocs.json`, `listCampaignEmailAccounts.newdocs.json`, `listCampaignLeads.newdocs-alt.json`, `listAllLeadsActivities.newdocs-alt.json`, `getEmailAccountWarmupStats.newdocs.json`, `getLeadMessageHistory.newdocs.json`, `getCampaignStatistics.newdocs-a.json`, `getCampaignStatistics.newdocs-b.json`, `getCampaignAnalytics.newdocs.json`, `getCampaignTopLevelAnalyticsByDate.newdocs-alt.json`, `listClients.newdocs.json`, `listCampaignWebhooks.newdocs.json`, `listLeadCategories.legacy.json`, `webhook.EMAIL_REPLY.newdocs.json`, `error.429.newdocs.json`.

## Illustrative-looking docs examples kept as documented

The docs examples behind `getLeadById.json`, `getBulkLeadMessageHistory.json`, `getInboxItem.json`, `listInboxReplies*.json`, `listInboxSent.json`, `listUntrackedReplies.json`, `listLeadLists.json`, `analyticsCampaignStatusStats.json` and the `analytics*` day-wise files look hand-written rather than captured. They are reproduced as documented; do not treat their field sets as confirmed.

## Webhook fixtures

`webhook.<EVENT_TYPE>.json` files are the "Example Response" payloads from the Notion webhook guide, sanitized. `webhook.email.account.disconnected.json` and `webhook.campaign.bounce_threshold.breached.json` are the two sample payloads from help-center article 403, which use a different envelope (`id`, `type`, `data`, `meta`). There is no documented payload for `FIRST_EMAIL_SENT` (docs say "same structure as `EMAIL_SENT`"), so there is no fixture for it.

## Added 2026-11-14 for stats per campaign and positive replies per day

| File | Source and what was synthesized |
| --- | --- |
| `analyticsDayWisePositiveReplyStats.json` | The documented example of `GET /analytics/day-wise-positive-reply-stats`, unchanged. |
| `analyticsCampaignOverallStats.json` | The documented example of `GET /analytics/campaign/overall-stats` has one campaign; its id was changed to a campaign of the other fixtures and a second campaign was added. |
