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

- countUnreadEmails.json
- createWebhook.json
- getAccount.json
- getAccountDailyAnalytics.json
- getAdminWorkspace.json
- getCampaign.json
- getCampaignAnalytics.json
- getCampaignAnalyticsDaily.json
- getCampaignAnalyticsOverview.json
- getCampaignAnalyticsSteps.json
- getCampaignSendingStatus.json
- getCampaignSequence.json
- getCurrentWorkspace.json
- getEmail.json
- getLead.json
- getSubsequence.json
- getSubsequenceAnalytics.json
- getWebhook.json
- getWorkspacePlanDetails.json
- listAccountCampaignMappings.json
- listAccountCampaignMappings.page2.json
- listAccounts.json
- listAccounts.page2.json
- listApiKeys.json
- listApiKeys.page2.json
- listCampaigns.json
- listCampaigns.page2.json
- listCustomTags.json
- listCustomTags.page2.json
- listEmails.json
- listEmails.page2.json
- listLeadLabels.json
- listLeadLabels.page2.json
- listLeadLists.json
- listLeadLists.page2.json
- listLeads.json
- listLeads.page2.json
- listReplies.json
- listReplies.page2.json
- listSubsequences.json
- listSubsequences.page2.json
- listWebhookEventTypes.json
- listWebhookEvents.json
- listWebhookEvents.page2.json
- listWebhooks.json
- listWebhooks.page2.json
- listWorkspaceGroupMembers.json
- listWorkspaceGroupMembers.page2.json
- listWorkspaceMembers.json
- listWorkspaceMembers.page2.json
- searchCampaignsByLeadEmail.json
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
