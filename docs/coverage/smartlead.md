# Smartlead coverage

Inventoried on 2026-11-14 from Smartlead's API reference at https://api.smartlead.ai/api-reference/, read through `https://api.smartlead.ai/llms-full.txt` (all 262 pages, 242 of them endpoint pages) and checked against `https://api.smartlead.ai/llms.txt`. The table has 230 endpoints: 27 normalized, 78 native, 20 excluded and 105 writes. It covers the main API (`https://server.smartlead.ai/api/v1`) and the four sister services the reference documents, each on its own host under `/api/v1`: SmartDelivery (`smartdelivery.smartlead.ai`), SmartProspect (`prospect-api.smartlead.ai`), SmartSenders (`smart-senders.smartlead.ai`) and SmartServers (`smartservers.smartlead.ai`); their rows name the service in the Reads column.

Notes on the count:

- Several endpoints have two reference pages (one under Campaigns, one under Leads, Inbox or Campaign Statistics). Each endpoint is listed once.
- Two pages document several endpoints each: client API keys and the domain block list. Every endpoint on them has its own row.
- `GET /leads/{lead_id}/campaigns` is only in the deprecated Notion reference. It is listed because `leads.timeline` calls it.
- `llms.txt` and the quickstart name a few short paths that have no reference page and contradict the reference (`GET /webhooks`, `GET /leads/by-email`, `GET /analytics/overview`, `POST /campaigns/new`). They are not listed.
- Nothing here was checked against a live account.

Two parameters are left out of the native catalog because they carry or return secrets: `includeWhitelabel` on `GET /client/{id}` (whitelabel credentials) and `private_api_key` on `GET /campaigns/{campaign_id}/mailbox-statistics`.

| Method | Path | Reads | Coverage | Through |
| --- | --- | --- | --- | --- |
| `GET` | `/analytics/campaign/follow-up-reply-rate` | The reply rate of follow-up steps (second email onwards) | native | `analyticsCampaignFollowUpReplyRate` |
| `GET` | `/analytics/campaign/lead-to-reply-time` | The average time from a lead's first email to its reply | native | `analyticsCampaignLeadToReplyTime` |
| `GET` | `/analytics/campaign/leads-take-for-first-reply` | How many leads are contacted, on average, per first reply | native | `analyticsCampaignLeadsForFirstReply` |
| `GET` | `/analytics/campaign/list` | The id and name of every campaign, for analytics filters | native | `analyticsCampaignList` |
| `GET` | `/analytics/campaign/overall-stats` | One row per campaign in a date window: counts, rates and lead totals | native | `analyticsCampaignPerformance` |
| `GET` | `/analytics/campaign/response-stats` | Replies per campaign in a date window, split by reply sentiment | native | `analyticsCampaignResponseStats` |
| `GET` | `/analytics/campaign/status-stats` | How many campaigns are in each status | native | `analyticsCampaignStatusStats` |
| `GET` | `/analytics/client/list` | The id and name of every client, for analytics filters | native | `analyticsClientList` |
| `GET` | `/analytics/client/month-wise-count` | How many clients the account had, month by month | native | `analyticsClientMonthlyCount` |
| `GET` | `/analytics/client/overall-stats` | One row per client in a date window, with that client's campaign totals | native | `analyticsClientPerformance` |
| `GET` | `/analytics/day-wise-overall-stats` | Sent, opened and replied counts per day | normalized | `stats.byDay` |
| `GET` | `/analytics/day-wise-overall-stats-by-sent-time` | Daily sent, opened, replied and bounced counts, each counted on the day its email was sent | native | `analyticsDailyBySentTime` |
| `GET` | `/analytics/day-wise-positive-reply-stats` | Positive replies per day, counted on the day of the reply | native | `analyticsDailyPositiveReplies` |
| `GET` | `/analytics/day-wise-positive-reply-stats-by-sent-time` | Positive replies per day, counted on the day the replied-to email was sent | native | `analyticsDailyPositiveRepliesBySentTime` |
| `GET` | `/analytics/lead/category-wise-response` | Replies in a date window by lead category, with each one's share | native | `analyticsLeadCategoryResponses` |
| `GET` | `/analytics/lead/overall-stats` | Leads reached in a date window: the total, new leads and follow-ups | native | `analyticsLeadStats` |
| `GET` | `/analytics/mailbox/domain-wise-health-metrics` | Sent, opened, replied and bounced counts per sending domain in a date window | native | `analyticsMailboxDomainHealth` |
| `GET` | `/analytics/mailbox/name-wise-health-metrics` | Sent, opened, replied and bounced counts per mailbox | normalized | `stats.bySender` |
| `GET` | `/analytics/mailbox/overall-stats` | How many mailboxes are connected, in use, disconnected, or enabled without warmup | native | `analyticsMailboxOverall` |
| `GET` | `/analytics/mailbox/provider-wise-overall-performance` | Counts and rates in a date window per mailbox provider (Gmail, Outlook, SMTP) | native | `analyticsMailboxProviderPerformance` |
| `GET` | `/analytics/overall-stats-v2` | The account's totals and rates in a date window | normalized | `stats.workspace` |
| `GET` | `/analytics/team-board/overall-stats` | Results in a date window per team member | native | `analyticsTeamBoard` |
| `GET` | `/campaigns/` | Every campaign, with its settings and parent campaign | normalized | `campaigns.list`, `sequence.subsequences` |
| `GET` | `/campaigns/all-leads-activities` | Sent emails and replies across every campaign, by lead | normalized | `messages.list` |
| `POST` | `/campaigns/assign-client` | Assign Client to Campaign | write |  |
| `POST` | `/campaigns/create` | Create Campaign | write |  |
| `POST` | `/campaigns/create-subsequence` | Create Subsequence Campaign | write |  |
| `POST` | `/campaigns/spintax-distribution-mode` | Update Spintax Distribution Mode | write |  |
| `DELETE` | `/campaigns/tags` | Remove Tags from Campaigns | write |  |
| `POST` | `/campaigns/tags` | Add Tags to Campaigns | write |  |
| `POST` | `/campaigns/update-folder` | Move Campaigns to Folder | write |  |
| `POST` | `/campaigns/update-lead-email-account` | Update Lead Email Account | write |  |
| `POST` | `/campaigns/{campaignId}/leads/filter` | A campaign's leads filtered by text, status, category, mailbox or step | native | `campaignLeadSearch` |
| `POST` | `/campaigns/{campaignId}/webhooks/retrigger-failed-events` | Retrigger Campaign Webhooks | write |  |
| `GET` | `/campaigns/{campaignId}/webhooks/summary` | How many webhook calls a campaign made in a time window, and how many failed | native | `campaignWebhookSummary` |
| `DELETE` | `/campaigns/{campaign_id}` | Delete Campaign | write |  |
| `GET` | `/campaigns/{campaign_id}` | One campaign with its schedule, caps, tracking and stop rules | normalized | `campaigns.get`, `campaigns.settings` |
| `GET` | `/campaigns/{campaign_id}/analytics` | A campaign's lifetime totals | normalized | `stats.campaign` |
| `GET` | `/campaigns/{campaign_id}/analytics-by-date` | A campaign's totals in a date window | normalized | `stats.campaign` |
| `POST` | `/campaigns/{campaign_id}/duplicate` | Duplicate Campaign | write |  |
| `DELETE` | `/campaigns/{campaign_id}/email-accounts` | Remove Email Accounts from Campaign | write |  |
| `GET` | `/campaigns/{campaign_id}/email-accounts` | A campaign's mailboxes | normalized | `senders.byCampaign` |
| `POST` | `/campaigns/{campaign_id}/email-accounts` | Add Email Accounts to Campaign | write |  |
| `POST` | `/campaigns/{campaign_id}/email-accounts/by-tag` | Add Email Accounts to Campaign by Tag | write |  |
| `POST` | `/campaigns/{campaign_id}/forward-email` | Forward Campaign Email | write |  |
| `GET` | `/campaigns/{campaign_id}/leads` | A campaign's leads, with status and category | normalized | `leads.byCampaign`, `leads.list` |
| `POST` | `/campaigns/{campaign_id}/leads` | Add Leads to Campaign | write |  |
| `GET` | `/campaigns/{campaign_id}/leads-export` | Every lead of a campaign as CSV text, with open, click and reply counts per lead | native | `campaignLeadsExport` |
| `GET` | `/campaigns/{campaign_id}/leads-statistics` | Per-lead statistics of a campaign | native | `campaignLeadStatistics` |
| `DELETE` | `/campaigns/{campaign_id}/leads/{lead_id}` | Delete Lead from Campaign | write |  |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_id}/` | Update Campaign Lead Details | write |  |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_id}/category` | Update Lead Category in Campaign | write |  |
| `GET` | `/campaigns/{campaign_id}/leads/{lead_id}/message-history` | A lead's sent and received messages in a campaign | normalized | `leads.timeline` |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_id}/pause` | Pause Campaign Lead | write |  |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_id}/resume` | Resume Campaign Lead | write |  |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_id}/unsubscribe` | Unsubscribe Lead from Campaign | write |  |
| `POST` | `/campaigns/{campaign_id}/leads/{lead_map_id}/manual-complete` | Mark Lead as Complete | write |  |
| `GET` | `/campaigns/{campaign_id}/mailbox-statistics` | A campaign's results per mailbox | native | `campaignMailboxStatistics` |
| `POST` | `/campaigns/{campaign_id}/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL` | The message history of many of a campaign's leads at once | native | `campaignMessageHistoryBulk` |
| `GET` | `/campaigns/{campaign_id}/prompt-template` | The AI prompt that categorises a campaign's replies, and the categories it may assign | native | `campaignPromptTemplate` |
| `POST` | `/campaigns/{campaign_id}/prompt-template` | Create Campaign AI Prompt Template | write |  |
| `PATCH` | `/campaigns/{campaign_id}/prompt-template/{template_id}` | Update Campaign AI Prompt Template | write |  |
| `POST` | `/campaigns/{campaign_id}/reallocate-mailboxes` | Reallocate Mailboxes | write |  |
| `POST` | `/campaigns/{campaign_id}/reply-email-thread` | Reply to Campaign Lead | write |  |
| `POST` | `/campaigns/{campaign_id}/schedule` | Update Campaign Schedule | write |  |
| `POST` | `/campaigns/{campaign_id}/send-test-email` | Send Test Email | write |  |
| `GET` | `/campaigns/{campaign_id}/sequence-analytics` | A campaign's results per step and variant | normalized | `stats.byStep` |
| `GET` | `/campaigns/{campaign_id}/sequences` | A campaign's steps and their variants | normalized | `sequence`, `sequence.subsequences` |
| `POST` | `/campaigns/{campaign_id}/sequences` | Update Campaign Sequences | write |  |
| `POST` | `/campaigns/{campaign_id}/settings` | Update Campaign Settings | write |  |
| `GET` | `/campaigns/{campaign_id}/statistics` | One row per email a campaign sent: the lead, the step, and when it was sent, opened, clicked, replied to or bounced | native | `campaignEmailStatistics` |
| `POST` | `/campaigns/{campaign_id}/status` | Update Campaign Status | write |  |
| `POST` | `/campaigns/{campaign_id}/team-member` | Update Campaign Team Member | write |  |
| `GET` | `/campaigns/{campaign_id}/top-level-analytics-by-date` | A campaign's top-level totals and rates in a date window, as the vendor computes them | native | `campaignTopLevelAnalyticsByDate` |
| `GET` | `/campaigns/{campaign_id}/webhooks` | A campaign's webhooks | normalized | `webhooks.list` |
| `POST` | `/campaigns/{campaign_id}/webhooks` | Create/Update Campaign Webhook | write |  |
| `DELETE` | `/campaigns/{campaign_id}/webhooks/{webhook_id}` | Delete Campaign Webhook | write |  |
| `GET` | `/client/` | Every client of the account | normalized | `workspaces` |
| `GET` | `/client/api-key` | Client API keys | excluded | The endpoint returns secrets: the API keys of client sub-accounts. |
| `POST` | `/client/api-key` | Create a client API key | write |  |
| `PUT` | `/client/api-key/reset/{id}` | Reset Client API Key | write |  |
| `DELETE` | `/client/api-key/{id}` | Delete Client API Key | write |  |
| `POST` | `/client/save` | Create or update a client | write |  |
| `POST` | `/client/{client_id}/code-integrations` | Add Client Code Snippet | write |  |
| `DELETE` | `/client/{id}` | Delete Client | write |  |
| `GET` | `/client/{id}` | One client, with its permissions, credits and code snippets on request | native | `client` |
| `GET` | `/crm/leads/notes/{id}` | The notes written on a lead | native | `leadNotes` |
| `GET` | `/crm/leads/tags` | A lead's tags | normalized | `leads.get` |
| `POST` | `/crm/leads/tags` | Add Tags to Lead | write |  |
| `DELETE` | `/crm/leads/tags/{tagMappingId}` | Remove Tag from Lead | write |  |
| `GET` | `/crm/leads/tasks/{id}` | The tasks created for a lead | native | `leadTasks` |
| `GET` | `/email-accounts/` | Every mailbox, with warmup details (the raw payload carries passwords) | normalized | `senders.list` |
| `POST` | `/email-accounts/bulk-update-email-account-config` | Bulk Update Email Account Config | write |  |
| `GET` | `/email-accounts/fetch-email-account-details` | One mailbox, looked up by its address | excluded | The endpoint returns secrets (the SMTP and IMAP passwords) and its payload is identical to GET /email-accounts/{email_account_id}/, which senders.get reads. |
| `POST` | `/email-accounts/reconnect-failed-email-accounts` | Reconnect Failed Email Accounts | write |  |
| `POST` | `/email-accounts/save` | Add SMTP Email Account | write |  |
| `POST` | `/email-accounts/save-oauth` | Add OAuth Email Account | write |  |
| `PUT` | `/email-accounts/suspend/{email_account_id}` | Suspend Email Account | write |  |
| `POST` | `/email-accounts/tag-list` | The tags of the mailboxes with the given addresses | native | `senderTagsByEmail` |
| `POST` | `/email-accounts/tag-manager` | Create or update a tag | write |  |
| `DELETE` | `/email-accounts/tag-mapping` | Remove Tags from Email Accounts | write |  |
| `POST` | `/email-accounts/tag-mapping` | Assign Tags to Email Accounts | write |  |
| `GET` | `/email-accounts/tags` | Every tag of the account | normalized | `tags` |
| `DELETE` | `/email-accounts/unsuspend/{email_account_id}` | Unsuspend Email Account | write |  |
| `POST` | `/email-accounts/{account_id}/send-otp-email` | Send Warmup Unblock OTP | write |  |
| `POST` | `/email-accounts/{account_id}/verify-otp` | Verify Warmup Unblock OTP | write |  |
| `DELETE` | `/email-accounts/{email_account_id}` | Delete Email Account | write |  |
| `GET` | `/email-accounts/{email_account_id}/` | One mailbox (the raw payload carries passwords) | normalized | `senders.get`, `senders.health`, `stats.bySender` |
| `POST` | `/email-accounts/{email_account_id}` | Update Email Account | write |  |
| `POST` | `/email-accounts/{email_account_id}/warmup` | Update Warmup Settings | write |  |
| `GET` | `/email-accounts/{email_account_id}/warmup-stats` | A mailbox's warmup results for the last 7 days | normalized | `senders.health` |
| `GET` | `/lead-list/` | Every lead list with its lead count | normalized | `lists.list` |
| `POST` | `/lead-list/` | Create Lead List | write |  |
| `POST` | `/lead-list/assign-tags` | Assign Tags to Lead Lists | write |  |
| `DELETE` | `/lead-list/{id}` | Delete Lead List | write |  |
| `GET` | `/lead-list/{id}` | One lead list: its name, lead count and dates | native | `leadList` |
| `PUT` | `/lead-list/{id}` | Update Lead List | write |  |
| `POST` | `/lead-list/{id}/import` | Import Leads to List | write |  |
| `GET` | `/leads/` | The lead with an email address and every campaign it is in | native | `leadByEmail` |
| `POST` | `/leads/add-domain-block-list` | Add to Block List | write |  |
| `POST` | `/leads/categories` | Create Lead Category | write |  |
| `DELETE` | `/leads/categories/{category_id}` | Delete Lead Category | write |  |
| `PATCH` | `/leads/categories/{category_id}` | Update Lead Category | write |  |
| `DELETE` | `/leads/delete-domain-block-list` | Delete from Block List | write |  |
| `GET` | `/leads/fetch-categories` | The lead categories, global and custom, with their sentiment | normalized | `replies.category` |
| `GET` | `/leads/get-domain-block-list` | Blocked addresses and domains | normalized | `blocklist` |
| `POST` | `/leads/leads/push-between-lists` | Move Leads Between Lists | write |  |
| `POST` | `/leads/push-to-campaign` | Push Leads to Campaign | write |  |
| `GET` | `/leads/{leadId}/campaign-overview` | A lead's status, category, revenue and current step in each of its campaigns | native | `leadCampaignOverview` |
| `GET` | `/leads/{leadMapId}/sequence-details` | The send status of every step for a lead in a campaign | native | `leadSequenceDetails` |
| `GET` | `/leads/{lead_id}` | One lead by id | normalized | `leads.get` |
| `GET` | `/leads/{lead_id}/campaigns` | The campaigns a lead is in (deprecated Notion reference only) | normalized | `leads.timeline` |
| `POST` | `/leads/{lead_id}/unsubscribe` | Unsubscribe Lead Globally | write |  |
| `POST` | `/master-inbox/archived` | Archived threads of the master inbox | native | `inboxArchived` |
| `POST` | `/master-inbox/assigned-me` | Threads assigned to the key's own user | native | `inboxAssignedToMe` |
| `POST` | `/master-inbox/block-domains` | Block Email Domains | write |  |
| `PATCH` | `/master-inbox/change-read-status` | Change Read Status | write |  |
| `POST` | `/master-inbox/create-note` | Create Lead Note | write |  |
| `POST` | `/master-inbox/create-task` | Create Lead Task | write |  |
| `PATCH` | `/master-inbox/ignore-reply` | Ignore Reply | write |  |
| `POST` | `/master-inbox/important` | Threads marked as important | native | `inboxImportant` |
| `POST` | `/master-inbox/inbox-replies` | Threads with a reply, across every campaign | normalized | `replies.list` |
| `POST` | `/master-inbox/push-to-subsequence` | Push Lead to Subsequence | write |  |
| `POST` | `/master-inbox/reminders` | Threads with a reminder, with its time and message | native | `inboxReminders` |
| `GET` | `/master-inbox/reply-status` | Whether a reply sent from the master inbox was delivered, and when | native | `replyStatus` |
| `PATCH` | `/master-inbox/resume-lead` | Resume Paused Lead | write |  |
| `POST` | `/master-inbox/saved-views` | Create Saved View | write |  |
| `POST` | `/master-inbox/scheduled` | Emails queued to be sent later, with their scheduled time | native | `inboxScheduled` |
| `POST` | `/master-inbox/sent` | Sent emails across every campaign, one thread per row | native | `inboxSent` |
| `POST` | `/master-inbox/set-reminder` | Set Lead Reminder | write |  |
| `POST` | `/master-inbox/snoozed` | Threads snoozed for later | native | `inboxSnoozed` |
| `POST` | `/master-inbox/unread-replies` | Threads with an unread reply | native | `inboxUnread` |
| `GET` | `/master-inbox/untracked-replies` | Replies that reached a connected mailbox but belong to no campaign | native | `inboxUntrackedReplies` |
| `POST` | `/master-inbox/untracked-replies/associate-to-lead` | Associate Untracked Reply to Lead | write |  |
| `PATCH` | `/master-inbox/update-category` | Update Lead Category | write |  |
| `PATCH` | `/master-inbox/update-revenue` | Update Lead Revenue | write |  |
| `POST` | `/master-inbox/update-team-member` | Assign Team Member | write |  |
| `POST` | `/master-inbox/views` | Threads matching a custom view: the inbox filters plus a subsequence | native | `inboxView` |
| `GET` | `/master-inbox/{id}` | One inbox thread with its messages | normalized | `messages.byThread` |
| `POST` | `/send-email/initiate` | Send Single Email | write |  |
| `POST` | `/tags` | Create Tag | write |  |
| `POST` | `/webhook/create` | Create Webhook | write |  |
| `DELETE` | `/webhook/delete` | Delete Campaign Webhook | write |  |
| `PUT` | `/webhook/update/{webhook_id}` | Update Webhook | write |  |
| `GET` | `/webhook/{webhook_id}` | One webhook: its URL, events, categories and campaign | native | `webhook` |
| `POST` | `/spam-test/delete` | SmartDelivery: Delete Tests in Bulk | write |  |
| `GET` | `/spam-test/folder` | SmartDelivery: The folders that organize placement tests | native | `deliveryFolders` |
| `POST` | `/spam-test/folder` | SmartDelivery: Create Folder | write |  |
| `DELETE` | `/spam-test/folder/{folderId}` | SmartDelivery: Delete Folder | write |  |
| `GET` | `/spam-test/folder/{folderId}` | SmartDelivery: One folder of placement tests | native | `deliveryFolder` |
| `POST` | `/spam-test/manual` | SmartDelivery: Create Manual Placement Test | write |  |
| `POST` | `/spam-test/report` | SmartDelivery: Every placement test, with its status and schedule | native | `deliveryTests` |
| `GET` | `/spam-test/report/mailboxes-count` | SmartDelivery: How many test mailboxes there are per provider | native | `deliveryMailboxCount` |
| `GET` | `/spam-test/report/mailboxes-summary` | SmartDelivery: A summary of every test mailbox | native | `deliveryMailboxSummary` |
| `GET` | `/spam-test/report/{spamTestId}/blacklist` | SmartDelivery: Whether a placement test's sending IPs are on a block list, per seed mailbox | native | `deliveryIpBlacklist` |
| `GET` | `/spam-test/report/{spamTestId}/dkim-details` | SmartDelivery: The DKIM result of each sender in a placement test | native | `deliveryDkimDetails` |
| `GET` | `/spam-test/report/{spamTestId}/domain-blacklist` | SmartDelivery: Whether a placement test's sending domains are on a block list | native | `deliveryDomainBlacklist` |
| `GET` | `/spam-test/report/{spamTestId}/email-content` | SmartDelivery: The email a placement test sent | native | `deliveryEmailContent` |
| `POST` | `/spam-test/report/{spamTestId}/groupwise` | SmartDelivery: A placement test's inbox and spam rates per region | native | `deliveryGeoReport` |
| `GET` | `/spam-test/report/{spamTestId}/ip-analytics` | SmartDelivery: The sending IP addresses a placement test saw | native | `deliveryIpDetails` |
| `POST` | `/spam-test/report/{spamTestId}/providerwise` | SmartDelivery: A placement test's inbox, spam and bounce rates per mailbox provider | native | `deliveryProviderReport` |
| `GET` | `/spam-test/report/{spamTestId}/rdns-details` | SmartDelivery: The reverse DNS of a placement test's sending IPs | native | `deliveryRdnsDetails` |
| `GET` | `/spam-test/report/{spamTestId}/schedule-history` | SmartDelivery: The runs of an automated placement test | native | `deliveryScheduleHistory` |
| `GET` | `/spam-test/report/{spamTestId}/sender-account-wise` | SmartDelivery: A placement test's results per sender mailbox | native | `deliverySenderReport` |
| `GET` | `/spam-test/report/{spamTestId}/sender-account-wise/{replyId}/email-headers` | SmartDelivery: The headers of one email a placement test received | native | `deliveryReplyHeaders` |
| `GET` | `/spam-test/report/{spamTestId}/sender-accounts` | SmartDelivery: The sender mailboxes of a placement test | native | `deliverySenderAccounts` |
| `GET` | `/spam-test/report/{spamTestId}/spam-filter-details` | SmartDelivery: Which spam filters a placement test's emails triggered, and why | native | `deliverySpamFilterDetails` |
| `GET` | `/spam-test/report/{spamTestId}/spf-details` | SmartDelivery: The SPF result of each sender in a placement test | native | `deliverySpfDetails` |
| `POST` | `/spam-test/schedule` | SmartDelivery: Create Automated Placement Test | write |  |
| `GET` | `/spam-test/seed/providers` | SmartDelivery: The mailbox provider ids per region that placement tests refer to | native | `deliverySeedProviders` |
| `GET` | `/spam-test/{spamTestId}` | SmartDelivery: One placement test: its type, campaign, step and provider | native | `deliveryTest` |
| `PUT` | `/spam-test/{spamTestId}/stop` | SmartDelivery: Stop Automated Test | write |  |
| `GET` | `/search-email-leads/cities` | SmartProspect: Cities to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/company` | SmartProspect: Company names to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/countries` | SmartProspect: Countries to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/departments` | SmartProspect: Departments to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/domain` | SmartProspect: Company domains to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `POST` | `/search-email-leads/fetch-contacts` | SmartProspect: Fetches contact emails for a search, spending credits | write |  |
| `POST` | `/search-email-leads/get-contacts` | SmartProspect: Contacts already saved from SmartProspect, by search filter or by id | native | `prospectContacts` |
| `GET` | `/search-email-leads/head-counts` | SmartProspect: Company size ranges to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/industries` | SmartProspect: Industries to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/job-title` | SmartProspect: Job titles to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/keywords` | SmartProspect: Keywords to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/levels` | SmartProspect: Seniority levels to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/reply-analytics` | SmartProspect: Replies from SmartProspect contacts this month against last month | native | `prospectReplyAnalytics` |
| `GET` | `/search-email-leads/revenue` | SmartProspect: Revenue ranges to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `PATCH` | `/search-email-leads/review-contacts/{filter_id}` | SmartProspect: Review Contacts API | write |  |
| `GET` | `/search-email-leads/search-analytics` | SmartProspect leads found, emails fetched and credits left, with the monthly trend | native | `prospectSearchAnalytics` |
| `POST` | `/search-email-leads/search-contacts` | SmartProspect: Searches the contact database and records the search as a filter | write |  |
| `POST` | `/search-email-leads/search-contacts/find-emails` | SmartProspect: Finds email addresses for up to 10 people, spending credits | write |  |
| `GET` | `/search-email-leads/search-filters/fetched-searches` | SmartProspect searches whose contacts were fetched, with their email counts | native | `prospectFetchedSearches` |
| `PUT` | `/search-email-leads/search-filters/fetched-searches/{id}` | SmartProspect: Update Fetched Lead API | write |  |
| `GET` | `/search-email-leads/search-filters/recent-searches` | SmartProspect: The most recent SmartProspect searches | native | `prospectRecentSearches` |
| `POST` | `/search-email-leads/search-filters/save-search` | SmartProspect: Save Search API | write |  |
| `PUT` | `/search-email-leads/search-filters/save-search/{id}` | SmartProspect: Update Saved Search API | write |  |
| `GET` | `/search-email-leads/search-filters/saved-searches` | SmartProspect: The saved SmartProspect searches | native | `prospectSavedSearches` |
| `GET` | `/search-email-leads/states` | SmartProspect: States to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/search-email-leads/sub-industries` | SmartProspect: Sub-industries to filter a contact search by | excluded | A filter value list of the SmartProspect contact database; it reports nothing about campaigns, leads, senders or results. |
| `POST` | `/smart-senders/add-mailboxes-to-domain` | SmartSenders: Add Mailboxes to Domain | write |  |
| `GET` | `/smart-senders/auth-secret` | SmartSenders: A one-time password for an admin mailbox | excluded | The endpoint returns secrets: a one-time password that signs in to a mailbox. |
| `POST` | `/smart-senders/auto-generate-mailboxes` | SmartSenders: Suggested mailbox addresses for domains about to be ordered | excluded | Address suggestions for a purchase; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/smart-senders/get-domain-list` | SmartSenders: The sending domains bought through SmartSenders | native | `smartSendersDomains` |
| `GET` | `/smart-senders/get-vendors` | SmartSenders: Mailbox vendors with their prices | excluded | Marketplace vendors and pricing; it reports nothing about campaigns, leads, senders or results. |
| `GET` | `/smart-senders/order-details` | SmartSenders: One SmartSenders order with its mailboxes | excluded | The endpoint returns secrets: the password of every mailbox in the order. |
| `POST` | `/smart-senders/place-order` | SmartSenders: Place Order | write |  |
| `GET` | `/smart-senders/search-domain` | SmartSenders: Whether a domain can be bought | excluded | Marketplace availability of a domain name; it reports nothing about campaigns, leads, senders or results. |
| `POST` | `/smart-infra/mapping` | SmartServers: Assign SmartInfra to Campaigns | write |  |
| `GET` | `/smart-server/` | SmartServers: The account's dedicated sending IPs, with the campaigns on each on request | native | `smartServers` |
| `GET` | `/smart-server/all/campaign/{campaign_id}` | SmartServers: The dedicated IP attached to a campaign; only one is returned when it has several | native | `smartServersForCampaign` |
| `DELETE` | `/smart-server/mapping/campaign/{campaign_id}` | SmartServers: Unassign SmartServers from Campaign | write |  |
