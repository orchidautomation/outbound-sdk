# Synthesized fixtures

Instantly's docs publish JSON Schemas with a per-field `example` value but (with one exception) no whole-response example. Every file listed here was BUILT from the schema in https://api.instantly.ai/openapi/api_v2.json (copy in `../sources/api_v2.openapi.json`) using each field's documented `example` value. Field names and nesting are exact; values are the docs' examples, with personal data replaced by fakes. They are not captured API responses. `../_gen/gen.py` regenerates them.

Conventions used when building:
- List fixtures contain 2 items (second item = first with ids/emails nudged so they differ).
- `*.page2.json` = assumed last page: one item and NO `next_starting_after`. UNVERIFIED: the docs never say how the last page is signalled; the field is merely optional in the schema.
- Every optional/nullable field is populated, so real responses will have more nulls and missing keys than these files.
- `getCampaignSequence.json` is the `sequences` field of the campaign object (there is no sequence endpoint).
- `listReplies.json` is `GET /emails` output with `ue_type` forced to 2 (Received).
- `createWebhook.json` is the response of the create call (the webhook object).
- `webhook.*.json` are built from the single generic payload schema in the webhook guide; Instantly documents no per-event payload example, so which optional fields appear for which event is UNVERIFIED. The event name in `webhook.email_link_clicked.json` follows the OpenAPI enum; the guide calls the same event `link_clicked`.

NOT synthesized:
- `getAccountWarmupAnalytics.json`: the documented whole-response example (emails normalised to person1/person2).
- `webhook.payload-schema.json`: the documented generic payload schema itself plus both documented event-name lists.

## Files

Only the files in this folder are listed. Values are fake: reserved domains and placeholder names.

Added on 2026-11-14 for the account-level reads, with values chosen so that no two mapped fields share one: `getAccountWarmupAnalytics.json`, `getEmail.json`, `listBlockListEntries*.json`, `listCustomTagMappings.json`, `listCustomTags*.json`, `listLeadLabels.json`, `listLeadLists*.json`, `listSubsequences*.json`, `listWebhooks*.json`, `testAccountVitals.json`. `getCampaign.json`, `listCampaigns*.json`, `getLead.json`, `listLeads*.json`, `listAccounts*.json`, `listEmails*.json` and `listReplies*.json` were edited the same day for the same reason (distinct settings, engagement counts, tags, and one truncated body per list). These were written by hand from the same schema, not by `gen.py`.

Added on 2026-11-14 for the lookup by email: `listLeadsByEmail*.json`, the response of `POST /leads/list` with `contacts` set, written by hand from the same schema. One address is in two campaigns and one list, and one record spells it with capitals, which is an assumption about what Instantly can return, not something documented.

- getAccount.json
- getAccountDailyAnalytics.json
- getAccountWarmupAnalytics.json
- getCampaign.json
- getCampaignAnalyticsDaily.json
- getCampaignAnalyticsOverview.json
- getCampaignAnalyticsSteps.json
- getCurrentWorkspace.json
- getEmail.json
- getLead.json
- listAccounts.json
- listAccounts.page2.json
- listBlockListEntries.json
- listBlockListEntries.page2.json
- listCampaigns.json
- listCampaigns.page2.json
- listCustomTagMappings.json
- listCustomTags.byIds.json
- listCustomTags.json
- listCustomTags.page2.json
- listEmails.json
- listEmails.page2.json
- listLeadLabels.json
- listLeadLists.json
- listLeadLists.page2.json
- listLeads.json
- listLeads.page2.json
- listLeadsByEmail.json
- listLeadsByEmail.page2.json
- listReplies.json
- listReplies.page2.json
- listSubsequences.json
- listSubsequences.page2.json
- listWebhooks.json
- listWebhooks.page2.json
- testAccountVitals.json
- webhook.account_error.json
- webhook.campaign_completed.json
- webhook.email_bounced.json
- webhook.email_link_clicked.json
- webhook.email_opened.json
- webhook.email_sent.json
- webhook.lead_closed.json
- webhook.lead_interested.json
- webhook.lead_meeting_booked.json
- webhook.lead_meeting_completed.json
- webhook.lead_neutral.json
- webhook.lead_not_interested.json
- webhook.lead_out_of_office.json
- webhook.lead_unsubscribed.json
- webhook.lead_wrong_person.json
- webhook.reply_received.json

## Added 2026-11-14 for stats per campaign and a mailbox's campaigns

- `getCampaignsAnalytics.json` (`GET /campaigns/analytics`): built from the response schema in the OpenAPI specification, which has no example. Every count has its own value.
- `listAccountCampaignMappings.json`, `listAccountCampaignMappings.page2.json` (`GET /account-campaign-mappings/{email}`): built from the response schema. The campaign ids are those of `listCampaigns.json`.
