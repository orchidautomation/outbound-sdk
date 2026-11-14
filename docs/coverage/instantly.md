# Instantly coverage

Every operation in Instantly's API V2 reference, taken on 2026-11-14 from the OpenAPI 3.1 specification at `https://api.instantly.ai/openapi/api_v2.json` (268 operations) and checked against the 268 endpoint pages listed in `https://developer.instantly.ai/llms.txt`. Paths are relative to `https://api.instantly.ai/api/v2`; Instantly documents no sister service on another host.

Of the 268 endpoints, 22 are used by normalized reads, 105 are in the native catalog (`src/instantly/native.ts`), 4 are excluded and 137 are writes. A `POST` counts as a read when Instantly lets a key with a `read` scope call it; every other `POST`, and every `PATCH`, `PUT` and `DELETE`, is a write.

| Method | Path | Reads | Coverage | Through |
| --- | --- | --- | --- | --- |
| `GET` | `/account-campaign-mappings/{email}` | Get campaigns associated with an email | native | `senderCampaigns` |
| `GET` | `/accounts` | List mailboxes | normalized | `senders.list`, `senders.byCampaign` |
| `POST` | `/accounts` | Create account | write |  |
| `GET` | `/accounts/analytics/daily` | Get daily account analytics | normalized | `stats.bySender` |
| `GET` | `/accounts/ctd/status` | Get custom tracking domain status | native | `trackingDomainStatus` |
| `POST` | `/accounts/move` | Move accounts between workspaces | write |  |
| `POST` | `/accounts/pause` | Pause multiple accounts | write |  |
| `POST` | `/accounts/test/vitals` | Test account vitals | normalized | `senders.health` |
| `POST` | `/accounts/warmup-analytics` | Get warmup analytics | normalized | `senders.health`, `senders.warmup` |
| `POST` | `/accounts/warmup/disable` | Disable warmup for accounts | write |  |
| `POST` | `/accounts/warmup/enable` | Enable warmup for accounts | write |  |
| `DELETE` | `/accounts/{email}` | Delete account | write |  |
| `GET` | `/accounts/{email}` | Get one mailbox | normalized | `senders.get`, `senders.health` |
| `PATCH` | `/accounts/{email}` | Patch account | write |  |
| `POST` | `/accounts/{email}/mark-fixed` | Mark an account as fixed | write |  |
| `POST` | `/accounts/{email}/pause` | Pause an account | write |  |
| `POST` | `/accounts/{email}/resume` | Resume a paused account | write |  |
| `GET` | `/agent-items` | List AI agent items | native | `agentItems` |
| `POST` | `/agent-items/bulk-delete` | Bulk delete AI agent items | write |  |
| `GET` | `/ai-agents/deliverability` | Get the default AI Deliverability Agent | native | `deliverabilityAgent` |
| `POST` | `/ai-agents/deliverability/deploy` | Deploy the default AI Deliverability Agent | write |  |
| `POST` | `/ai-agents/deliverability/feed-items/{id}/complete` | Complete a Deliverability Agent feed item | write |  |
| `POST` | `/ai-agents/deliverability/feed-items/{id}/pause-affected-accounts` | Pause accounts affected by a deliverability recommendation | write |  |
| `POST` | `/ai-agents/deliverability/feed-items/{id}/pause-campaign-sending` | Pause campaign sending for affected accounts | write |  |
| `POST` | `/ai-agents/deliverability/run-now` | Run Deliverability Agent now | write |  |
| `PATCH` | `/ai-agents/deliverability/settings` | Update the default AI Deliverability Agent settings | write |  |
| `GET` | `/ai-agents/deliverability/state` | Get the default AI Deliverability Agent state | native | `deliverabilityAgentState` |
| `DELETE` | `/ai-agents/deliverability/{id}` | Delete an AI Deliverability Agent | write |  |
| `GET` | `/ai-agents/deliverability/{id}` | Get an AI Deliverability Agent | native | `deliverabilityAgentById` |
| `PATCH` | `/ai-agents/deliverability/{id}` | Update an AI Deliverability Agent | write |  |
| `GET` | `/ai-agents/deliverability/{id}/feed-items` | List AI Deliverability Agent feed items | native | `deliverabilityAgentFeed` |
| `GET` | `/ai-agents/deliverability/{id}/state` | Get AI Deliverability Agent state | native | `deliverabilityAgentStateById` |
| `GET` | `/ai-agents/inbox-manager` | List AI Inbox Managers | native | `inboxManagers` |
| `POST` | `/ai-agents/inbox-manager` | Create an AI Inbox Manager | write |  |
| `DELETE` | `/ai-agents/inbox-manager/{id}` | Delete an AI Inbox Manager | write |  |
| `GET` | `/ai-agents/inbox-manager/{id}` | Get an AI Inbox Manager | native | `inboxManager` |
| `PATCH` | `/ai-agents/inbox-manager/{id}` | Update an AI Inbox Manager | write |  |
| `GET` | `/ai-agents/inbox-manager/{id}/analytics/activity` | List AI Inbox Manager activity | native | `inboxManagerActivity` |
| `GET` | `/ai-agents/inbox-manager/{id}/analytics/summary` | Get AI Inbox Manager analytics summary | native | `inboxManagerSummary` |
| `GET` | `/ai-agents/inbox-manager/{id}/analytics/summary-by-date` | Get AI Inbox Manager analytics by date | native | `inboxManagerSummaryByDate` |
| `GET` | `/ai-agents/inbox-manager/{id}/guidances` | List AI Inbox Manager guidances | native | `inboxManagerGuidances` |
| `POST` | `/ai-agents/inbox-manager/{id}/guidances` | Create an AI Inbox Manager guidance | write |  |
| `DELETE` | `/ai-agents/inbox-manager/{id}/guidances/{guidance_id}` | Delete an AI Inbox Manager guidance | write |  |
| `GET` | `/ai-agents/inbox-manager/{id}/guidances/{guidance_id}` | Get an AI Inbox Manager guidance | native | `inboxManagerGuidance` |
| `PATCH` | `/ai-agents/inbox-manager/{id}/guidances/{guidance_id}` | Update an AI Inbox Manager guidance | write |  |
| `GET` | `/ai-agents/inbox-manager/{id}/replies` | List AI Inbox Manager replies | native | `inboxManagerReplies` |
| `GET` | `/ai-agents/inbox-manager/{id}/replies/{reply_id}` | Get an AI Inbox Manager reply | native | `inboxManagerReply` |
| `PATCH` | `/ai-agents/inbox-manager/{id}/replies/{reply_id}` | Update an AI Inbox Manager reply | write |  |
| `GET` | `/ai-agents/lead-finder` | List AI Lead Finder Agents | native | `leadFinderAgents` |
| `POST` | `/ai-agents/lead-finder` | Create an AI Lead Finder Agent | write |  |
| `GET` | `/ai-agents/lead-finder/enrichment-workflows` | List saved enrichment workflows | native | `leadFinderWorkflows` |
| `POST` | `/ai-agents/lead-finder/enrichment-workflows` | Save an enrichment workflow | write |  |
| `DELETE` | `/ai-agents/lead-finder/enrichment-workflows/{id}` | Delete a saved enrichment workflow | write |  |
| `POST` | `/ai-agents/lead-finder/suggest-audience` | Suggest audiences from a campaign | native | `leadFinderAudienceSuggestions` |
| `DELETE` | `/ai-agents/lead-finder/{id}` | Delete an AI Lead Finder Agent | write |  |
| `GET` | `/ai-agents/lead-finder/{id}` | Get an AI Lead Finder Agent | native | `leadFinderAgent` |
| `PATCH` | `/ai-agents/lead-finder/{id}` | Update an AI Lead Finder Agent | write |  |
| `GET` | `/ai-agents/lead-finder/{id}/activities` | List AI Lead Finder Agent activities | native | `leadFinderActivities` |
| `POST` | `/ai-agents/lead-finder/{id}/pause` | Pause an AI Lead Finder Agent | write |  |
| `POST` | `/ai-agents/lead-finder/{id}/resume` | Resume an AI Lead Finder Agent | write |  |
| `GET` | `/ai-agents/lead-finder/{id}/stats` | Get AI Lead Finder Agent lifetime stats | native | `leadFinderStats` |
| `GET` | `/ai-agents/sales` | List AI Sales Agents | native | `salesAgents` |
| `POST` | `/ai-agents/sales` | Create an AI Sales Agent | write |  |
| `DELETE` | `/ai-agents/sales/{id}` | Delete an AI Sales Agent | write |  |
| `GET` | `/ai-agents/sales/{id}` | Get an AI Sales Agent | native | `salesAgent` |
| `PATCH` | `/ai-agents/sales/{id}` | Update an AI Sales Agent | write |  |
| `GET` | `/ai-agents/sales/{id}/activities` | List AI Sales Agent activities | native | `salesAgentActivities` |
| `POST` | `/ai-agents/sales/{id}/activities/approve` | Approve multiple AI Sales Agent activities | write |  |
| `POST` | `/ai-agents/sales/{id}/activities/reject` | Reject multiple AI Sales Agent activities | write |  |
| `POST` | `/ai-agents/sales/{id}/activities/{activity_id}/approve` | Approve an AI Sales Agent activity | write |  |
| `POST` | `/ai-agents/sales/{id}/activities/{activity_id}/reject` | Reject an AI Sales Agent activity | write |  |
| `GET` | `/ai-agents/sales/{id}/analytics` | Get AI Sales Agent analytics | native | `salesAgentAnalytics` |
| `GET` | `/ai-agents/sales/{id}/guidance-rules` | List AI Sales Agent guidance rules | native | `salesAgentGuidanceRules` |
| `POST` | `/ai-agents/sales/{id}/guidance-rules` | Create an AI Sales Agent guidance rule | write |  |
| `DELETE` | `/ai-agents/sales/{id}/guidance-rules/{rule_id}` | Delete an AI Sales Agent guidance rule | write |  |
| `PATCH` | `/ai-agents/sales/{id}/guidance-rules/{rule_id}` | Update an AI Sales Agent guidance rule | write |  |
| `GET` | `/ai-agents/sales/{id}/leads/activity` | List AI Sales Agent lead activity | native | `salesAgentLeadActivity` |
| `GET` | `/ai-agents/sales/{id}/leads/activity/summary` | Get AI Sales Agent lead activity summary | native | `salesAgentLeadActivitySummary` |
| `GET` | `/ai-agents/sales/{id}/leads/{lead_id}/research` | Get research sources for an AI Sales Agent lead | native | `salesAgentLeadResearch` |
| `GET` | `/ai-agents/sales/{id}/opportunities/summary` | Get AI Sales Agent opportunity summary | native | `salesAgentOpportunities` |
| `GET` | `/api-keys` | List API keys | excluded | Returns secrets: each item carries the API key itself in `key`. |
| `POST` | `/api-keys` | Create api key | write |  |
| `DELETE` | `/api-keys/{id}` | Delete api key | write |  |
| `GET` | `/audit-logs` | List audit log | native | `auditLogs` |
| `GET` | `/background-jobs` | List background job | native | `backgroundJobs` |
| `GET` | `/background-jobs/{id}` | Get background job | native | `backgroundJob` |
| `DELETE` | `/block-lists-entries` | Delete all block list entries | write |  |
| `GET` | `/block-lists-entries` | List block list entries | normalized | `blocklist` |
| `POST` | `/block-lists-entries` | Create block list entry | write |  |
| `POST` | `/block-lists-entries/bulk-create` | Bulk create block list entry | write |  |
| `POST` | `/block-lists-entries/bulk-delete` | Bulk delete block list entry | write |  |
| `GET` | `/block-lists-entries/download` | Download all block list entries as CSV | native | `blocklistCsv` |
| `DELETE` | `/block-lists-entries/{id}` | Delete block list entry | write |  |
| `GET` | `/block-lists-entries/{id}` | Get block list entry | native | `blocklistEntry` |
| `PATCH` | `/block-lists-entries/{id}` | Patch block list entry | write |  |
| `GET` | `/campaigns` | List campaigns | normalized | `campaigns.list`, `campaigns.status` |
| `POST` | `/campaigns` | Create campaign | write |  |
| `GET` | `/campaigns/analytics` | Get campaign(s) analytics | native | `campaignAnalytics` |
| `GET` | `/campaigns/analytics/daily` | Get daily campaign analytics | normalized | `stats.byDay` |
| `GET` | `/campaigns/analytics/overview` | Get campaign(s) analytics overview | normalized | `stats.campaign`, `stats.workspace` |
| `GET` | `/campaigns/analytics/steps` | Get campaign steps analytics | normalized | `stats.byStep` |
| `GET` | `/campaigns/count-launched` | Get launched campaigns count | native | `launchedCampaignCount` |
| `GET` | `/campaigns/search-by-contact` | Search campaigns by lead email | native | `campaignsByLeadEmail` |
| `DELETE` | `/campaigns/{id}` | Delete campaign | write |  |
| `GET` | `/campaigns/{id}` | Get one campaign, with its schedule, sequences and settings | normalized | `campaigns.get`, `campaigns.settings`, `sequence`, `senders.byCampaign` |
| `PATCH` | `/campaigns/{id}` | Patch campaign | write |  |
| `POST` | `/campaigns/{id}/activate` | Activate(start), or resume a campaign | write |  |
| `POST` | `/campaigns/{id}/duplicate` | Duplicate campaign | write |  |
| `POST` | `/campaigns/{id}/export` | Export campaign to JSON format | native | `campaignExport` |
| `POST` | `/campaigns/{id}/from-export` | Create campaign from shared one | write |  |
| `POST` | `/campaigns/{id}/pause` | Stop(or pause) a campaign | write |  |
| `GET` | `/campaigns/{id}/sending-status` | Get campaign sending status | native | `campaignSendingStatus` |
| `POST` | `/campaigns/{id}/share` | Share a campaign | write |  |
| `POST` | `/campaigns/{id}/variables` | Add campaign variables | write |  |
| `GET` | `/creator-search/capabilities` | Get what creator search currently supports and what enrichment costs | native | `creatorSearchCapabilities` |
| `GET` | `/creator-search/dictionaries` | Get creator search dictionaries | native | `creatorSearchDictionaries` |
| `GET` | `/creator-search/locations` | Get creator search locations | native | `creatorSearchLocations` |
| `POST` | `/creator-search/outreach-batches` | Enrich selected creators, or the first creators of a search, into a creator list | write |  |
| `GET` | `/creator-search/outreach-batches/{id}` | Get a creator outreach batch | native | `creatorOutreachBatch` |
| `POST` | `/creator-search/search` | Search creators | write |  |
| `GET` | `/creator-search/search-allowance` | Get the free creator search pages left today and the price after them | native | `creatorSearchAllowance` |
| `GET` | `/crm-actions/phone-numbers` | List phone numbers | native | `crmPhoneNumbers` |
| `DELETE` | `/crm-actions/phone-numbers/{id}` | Delete phone number | write |  |
| `GET` | `/custom-tag-mappings` | List which tag is on which campaign or mailbox | normalized | `campaigns.list`, `campaigns.get` |
| `GET` | `/custom-tags` | List custom tags | normalized | `tags`, `campaigns.list`, `campaigns.get` |
| `POST` | `/custom-tags` | Create custom tag | write |  |
| `POST` | `/custom-tags/search` | List custom tags assigned to resources | native | `tagsOfResources` |
| `POST` | `/custom-tags/toggle-resource` | Assign or unassign tags to resources | write |  |
| `DELETE` | `/custom-tags/{id}` | Delete custom tag | write |  |
| `GET` | `/custom-tags/{id}` | Get custom tag | native | `tag` |
| `PATCH` | `/custom-tags/{id}` | Patch custom tag | write |  |
| `GET` | `/dfy-email-account-orders` | List dfy email account order | native | `dfyOrders` |
| `POST` | `/dfy-email-account-orders` | Place a DFY email account order | write |  |
| `GET` | `/dfy-email-account-orders/accounts` | List done-for-you mailboxes (passwords only on request) | native | `dfyAccounts` |
| `POST` | `/dfy-email-account-orders/accounts/cancel` | Cancel dfy email accounts | write |  |
| `POST` | `/dfy-email-account-orders/domains/check` | Check domains availability | write |  |
| `POST` | `/dfy-email-account-orders/domains/pre-warmed-up-list` | Get pre-warmed up domains | native | `dfyPreWarmedDomains` |
| `POST` | `/dfy-email-account-orders/domains/similar` | Generate similar available domains | write |  |
| `DELETE` | `/domains/{domain}/forwarding` | Remove domain forwarding | write |  |
| `GET` | `/domains/{domain}/forwarding` | Get domain forwarding | native | `domainForwarding` |
| `PUT` | `/domains/{domain}/forwarding` | Set domain forwarding | write |  |
| `POST` | `/email-verification` | Create email verification | write |  |
| `GET` | `/email-verification/{email}` | Check an email verification status | native | `emailVerification` |
| `GET` | `/emails` | List emails sent and received | normalized | `messages.list`, `messages.byThread`, `messages.since`, `replies.list`, `replies.since`, `leads.timeline` |
| `POST` | `/emails/forward` | Forward an email | write |  |
| `POST` | `/emails/reply` | Reply to an email | write |  |
| `POST` | `/emails/test` | Send a test email | write |  |
| `POST` | `/emails/threads/{thread_id}/mark-as-read` | Mark all emails in a thread as read | write |  |
| `GET` | `/emails/unread/count` | Count unread emails | native | `inboxUnreadCount` |
| `DELETE` | `/emails/{id}` | Delete email | write |  |
| `GET` | `/emails/{id}` | Get one email with its whole body | normalized | `messages.body` |
| `PATCH` | `/emails/{id}` | Patch email | write |  |
| `GET` | `/inbox-placement-analytics` | List inbox placement analytics | native | `inboxPlacementResults` |
| `POST` | `/inbox-placement-analytics/deliverability-insights` | Retrieve inbox placement analytics deliverability insights | native | `inboxPlacementInsights` |
| `POST` | `/inbox-placement-analytics/stats-by-date` | Get inbox placement analytics stats by date | native | `inboxPlacementStatsByDate` |
| `POST` | `/inbox-placement-analytics/stats-by-test-id` | Retrieve inbox placement analytics stats by test id | native | `inboxPlacementStatsByTest` |
| `GET` | `/inbox-placement-analytics/{id}` | Get inbox placement analytics | native | `inboxPlacementResult` |
| `GET` | `/inbox-placement-reports` | List inbox placement blacklist and spamassassin report | native | `inboxPlacementReports` |
| `GET` | `/inbox-placement-reports/{id}` | Get inbox placement blacklist and spamassassin report | native | `inboxPlacementReport` |
| `GET` | `/inbox-placement-tests` | List inbox placement test | native | `inboxPlacementTests` |
| `POST` | `/inbox-placement-tests` | Create inbox placement test | write |  |
| `GET` | `/inbox-placement-tests/email-service-provider-options` | Get ESP options | native | `inboxPlacementEspOptions` |
| `DELETE` | `/inbox-placement-tests/{id}` | Delete inbox placement test | write |  |
| `GET` | `/inbox-placement-tests/{id}` | Get inbox placement test | native | `inboxPlacementTest` |
| `PATCH` | `/inbox-placement-tests/{id}` | Patch inbox placement test | write |  |
| `GET` | `/lead-labels` | List custom lead labels | normalized | `replies.category`, `leads.list`, `leads.get` |
| `POST` | `/lead-labels` | Create lead label | write |  |
| `POST` | `/lead-labels/ai-reply-label` | Test AI reply label prediction | native | `leadLabelPrediction` |
| `DELETE` | `/lead-labels/{id}` | Delete lead label | write |  |
| `GET` | `/lead-labels/{id}` | Get lead label | native | `leadLabel` |
| `PATCH` | `/lead-labels/{id}` | Patch lead label | write |  |
| `GET` | `/lead-lists` | List lead lists | normalized | `lists.list` |
| `POST` | `/lead-lists` | Create lead list | write |  |
| `DELETE` | `/lead-lists/{id}` | Delete lead list | write |  |
| `GET` | `/lead-lists/{id}` | Get lead list | native | `leadList` |
| `PATCH` | `/lead-lists/{id}` | Patch lead list | write |  |
| `GET` | `/lead-lists/{id}/verification-stats` | Get verification statistics for a lead list | native | `leadListVerificationStats` |
| `DELETE` | `/leads` | Delete leads in bulk | write |  |
| `POST` | `/leads` | Create lead | write |  |
| `POST` | `/leads/add` | Add leads in bulk to a campaign or list | write |  |
| `POST` | `/leads/bulk-assign` | Bulk assign leads to organization users | write |  |
| `POST` | `/leads/list` | List leads | normalized | `leads.list`, `leads.byCampaign`, `leads.lookup`, `lists.leads`, `leads.engagement` |
| `POST` | `/leads/merge` | Merge two leads | write |  |
| `POST` | `/leads/move` | Move leads to a campaign or list | write |  |
| `POST` | `/leads/subsequence/move` | Move a lead to a subsequence | write |  |
| `POST` | `/leads/subsequence/remove` | Remove a lead from a subsequence | write |  |
| `POST` | `/leads/update-interest-status` | Update the interest status of a lead | write |  |
| `DELETE` | `/leads/{id}` | Delete lead | write |  |
| `GET` | `/leads/{id}` | Get lead | normalized | `leads.get`, `leads.timeline` |
| `PATCH` | `/leads/{id}` | Patch lead | write |  |
| `POST` | `/local-business-search/ai-filters` | Turn a sentence into local business search filters | native | `localBusinessFilters` |
| `POST` | `/local-business-search/convert` | Turn local businesses into leads | write |  |
| `GET` | `/local-business-search/convert/{id}` | Read a local business convert job | native | `localBusinessConversion` |
| `GET` | `/local-business-search/places` | Suggest cities for a local business search | native | `localBusinessPlaces` |
| `POST` | `/local-business-search/search` | Search local businesses | native | `localBusinessSearch` |
| `POST` | `/oauth/google/init` | Initialize google oauth | write |  |
| `POST` | `/oauth/microsoft/init` | Initialize microsoft oauth | write |  |
| `GET` | `/oauth/session/status/{sessionId}` | Get oauth session status | excluded | Reports nothing about campaigns, leads, senders or results: it is the progress of a mailbox sign-in that only a write can start. |
| `GET` | `/subsequences` | List a campaign's subsequences | normalized | `sequence.subsequences` |
| `POST` | `/subsequences` | Create campaign subsequence | write |  |
| `GET` | `/subsequences/analytics` | Get subsequence analytics summary | native | `subsequenceAnalytics` |
| `DELETE` | `/subsequences/{id}` | Delete campaign subsequence | write |  |
| `GET` | `/subsequences/{id}` | Get campaign subsequence | native | `subsequence` |
| `PATCH` | `/subsequences/{id}` | Patch campaign subsequence | write |  |
| `GET` | `/subsequences/{id}/analytics/steps` | Get subsequence step and variant analytics | native | `subsequenceStepAnalytics` |
| `POST` | `/subsequences/{id}/duplicate` | Duplicate a subsequence | write |  |
| `POST` | `/subsequences/{id}/pause` | Pause a subsequence | write |  |
| `POST` | `/subsequences/{id}/resume` | Resume a paused subsequence | write |  |
| `GET` | `/subsequences/{id}/sending-status` | Get subsequence sending status | native | `subsequenceSendingStatus` |
| `POST` | `/supersearch-enrichment/` | Create an enrichment | write |  |
| `POST` | `/supersearch-enrichment/ai` | Create AI enrichment | write |  |
| `GET` | `/supersearch-enrichment/ai/{resource_id}/in-progress` | Get AI enrichment for resource | native | `aiEnrichmentsInProgress` |
| `GET` | `/supersearch-enrichment/company-lists` | List company lists | native | `companyLists` |
| `POST` | `/supersearch-enrichment/company-lists` | Create a company list build | write |  |
| `GET` | `/supersearch-enrichment/company-lists/filter-options` | Get remote filter options for a catalog-backed company-list filter | native | `companyListFilterOptions` |
| `GET` | `/supersearch-enrichment/company-lists/recipes` | List company-list recipes | native | `companyListRecipes` |
| `GET` | `/supersearch-enrichment/company-lists/sources` | List company-list sources | native | `companyListSources` |
| `DELETE` | `/supersearch-enrichment/company-lists/{company_list_id}` | Delete a terminal company list | write |  |
| `GET` | `/supersearch-enrichment/company-lists/{company_list_id}` | Get company-list status | native | `companyList` |
| `PATCH` | `/supersearch-enrichment/company-lists/{company_list_id}` | Rename a terminal company list | write |  |
| `GET` | `/supersearch-enrichment/company-lists/{company_list_id}/companies` | List company-list members | native | `companyListCompanies` |
| `POST` | `/supersearch-enrichment/count-leads-from-supersearch` | Count leads from supersearch | native | `superSearchLeadCount` |
| `POST` | `/supersearch-enrichment/enrich-leads-from-supersearch` | Enrich leads from supersearch | write |  |
| `GET` | `/supersearch-enrichment/history/{resource_id}` | Get enrichment history | native | `enrichmentHistory` |
| `GET` | `/supersearch-enrichment/integrations/providers` | Returns the full integration provider registry | native | `enrichmentProviders` |
| `POST` | `/supersearch-enrichment/integrations/run` | Run a single integration lookup action synchronously | write |  |
| `POST` | `/supersearch-enrichment/preview-leads-from-supersearch` | Preview leads from supersearch | native | `superSearchLeadPreview` |
| `POST` | `/supersearch-enrichment/run` | Run enrichment for resource | write |  |
| `GET` | `/supersearch-enrichment/saved-searches` | List saved searches | native | `savedSearches` |
| `POST` | `/supersearch-enrichment/saved-searches` | Save a search | write |  |
| `DELETE` | `/supersearch-enrichment/saved-searches/{id}` | Delete a saved search | write |  |
| `GET` | `/supersearch-enrichment/saved-searches/{id}` | Get a saved search | native | `savedSearch` |
| `PATCH` | `/supersearch-enrichment/saved-searches/{id}` | Update a saved search | write |  |
| `POST` | `/supersearch-enrichment/signal-keywords-facet` | Facet keywords for a signal category | native | `superSearchSignalKeywords` |
| `GET` | `/supersearch-enrichment/{resource_id}` | Get enrichment for resource | native | `enrichment` |
| `PATCH` | `/supersearch-enrichment/{resource_id}/settings` | Update enrichment settings for resource | write |  |
| `GET` | `/webhook-events` | List webhook event | native | `webhookEvents` |
| `GET` | `/webhook-events/summary` | Get overview aggregates for webhook events | native | `webhookEventSummary` |
| `GET` | `/webhook-events/summary-by-date` | Get overview aggregates for webhook events by date | native | `webhookEventSummaryByDate` |
| `GET` | `/webhook-events/{id}` | Get webhook event | native | `webhookEvent` |
| `GET` | `/webhooks` | List webhooks | normalized | `webhooks.list` |
| `POST` | `/webhooks` | Create webhook | write |  |
| `GET` | `/webhooks/event-types` | List available event types | native | `webhookEventTypes` |
| `DELETE` | `/webhooks/{id}` | Delete webhook | write |  |
| `GET` | `/webhooks/{id}` | Get webhook | native | `webhook` |
| `PATCH` | `/webhooks/{id}` | Patch webhook | write |  |
| `POST` | `/webhooks/{id}/resume` | Resume a webhook | write |  |
| `POST` | `/webhooks/{id}/test` | Test a webhook | write |  |
| `GET` | `/workspace-billing/plan-details` | Get workspace plan details | excluded | Reports nothing about campaigns, leads, senders or results: it is the workspace's billing plan. |
| `GET` | `/workspace-billing/subscription-details` | Get workspace subscription details | excluded | Reports nothing about campaigns, leads, senders or results: it is the workspace's billing subscription. |
| `GET` | `/workspace-group-members` | List workspace group member | native | `workspaceGroupMembers` |
| `POST` | `/workspace-group-members` | Create workspace group member | write |  |
| `GET` | `/workspace-group-members/admin` | Get the current workspace admin workspace | native | `workspaceGroupAdmin` |
| `DELETE` | `/workspace-group-members/{id}` | Delete workspace group member | write |  |
| `GET` | `/workspace-group-members/{id}` | Get workspace group member | native | `workspaceGroupMember` |
| `GET` | `/workspace-members` | List workspace member | native | `workspaceMembers` |
| `POST` | `/workspace-members` | Create workspace member | write |  |
| `DELETE` | `/workspace-members/{id}` | Delete workspace member | write |  |
| `GET` | `/workspace-members/{id}` | Get workspace member | native | `workspaceMember` |
| `PATCH` | `/workspace-members/{id}` | Patch workspace member | write |  |
| `GET` | `/workspaces/current` | Get the workspace of the API key | normalized | `workspaces` |
| `PATCH` | `/workspaces/current` | Patch workspace | write |  |
| `POST` | `/workspaces/current/change-owner` | Change workspace owner | write |  |
| `DELETE` | `/workspaces/current/schedule-for-removal` | Cancel Current Workspace Removal | write |  |
| `POST` | `/workspaces/current/schedule-for-removal` | Schedule Current Workspace Removal | write |  |
| `DELETE` | `/workspaces/current/whitelabel-domain` | Delete organization agency domain | write |  |
| `GET` | `/workspaces/current/whitelabel-domain` | Get organization verified agency domain information | native | `whitelabelDomain` |
| `POST` | `/workspaces/current/whitelabel-domain` | Set the agency domain for the workspace | write |  |

## Notes

- `dfyAccounts` leaves out the documented `with_passwords` parameter, so a mailbox password cannot be asked for.
- `ids` on `campaignAnalytics`, and `action_status` and `action_type` on `salesAgentActivities`, are arrays that Instantly takes as a repeated query key. The catalog sends one value.
- `POST /creator-search/search` is listed as a write: Instantly asks for a `create` scope and charges credits for it after the free pages of the day.
- `GET /lead-lists/{id}/verification-stats` is the only place a lead list's size (`total_leads`) is reported. It is one request per list, so it stays native and a normalized list's `size` stays `null`.
