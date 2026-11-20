---
"outbound-sdk": minor
---

**Breaking: the built-in tools answer in camel case, like insights, and every record they return names its tool and workspace (OUT-166).** Tool inputs stay snake case: snake case goes in, camel case comes out. A stored tool result from an earlier version keeps the old names, and [cards](/docs/cards) read only the new ones.

Renamed answer fields, old to new:

- `campaign_overview`: each campaign's `name` is `campaignName`, as in insights. In `metrics` (also in `winning_steps`): `reply_rate` → `replyRate`, `reply_rate_basis` → `replyRateBasis`, `positive_reply_rate` → `positiveReplyRate`, `bounce_rate` → `bounceRate`, `connections_sent` → `connectionsSent`, `connections_accepted` → `connectionsAccepted`.
- `winning_steps`: `step_index` → `stepIndex`, `step_number` → `stepNumber`.
- `reply_samples`: `unique_people` → `uniquePeople`, `unique_threads` → `uniqueThreads`; each reply's `category_source` → `categorySource`, `is_auto` → `isAuto`, `lead_email` → `leadEmail`, `received_at` → `receivedAt`; each `by: "person"` row's `first_at` → `firstAt`, `last_at` → `lastAt`, `lead_email` → `leadEmail`, `thread_ids` → `threadIds`.
- `lead_runway`: `active_leads` → `activeLeads`, `contacted_per_day` → `contactedPerDay`, `counted_leads` → `countedLeads`, `in_sequence` → `inSequence`, `not_started` → `notStarted`, `runway_days` → `runwayDays`.
- `compare_clients`: `reply_rate` → `replyRate`.
- `cross_channel_lead`: each timeline message's `is_auto` → `isAuto`, `sent_at` → `sentAt`; each record's and link's `workspace` → `workspaceId`.
- `campaign_setup`: `daily_limit` → `dailyLimit`, `daily_new_leads` → `dailyNewLeads`, `end_date` → `endDate`, `gap_minutes` → `gapMinutes`, `plain_text` → `plainText`, `start_date` → `startDate`, `stop_on_auto_reply` → `stopOnAutoReply`, `stop_on_reply` → `stopOnReply`, `track_clicks` → `trackClicks`, `track_opens` → `trackOpens`.
- `audience_lists`: each list's `created_at` → `createdAt`.
- `sender_health`: each sender's `daily_limit` → `dailyLimit`, `warmup_enabled` → `warmupEnabled`, `warmup_score` → `warmupScore`.
- `deliverability_check`: `with_problems` → `withProblems`; `coverage.not_checked` → `coverage.notChecked`, `coverage.not_checked_by_reason` → `coverage.notCheckedByReason`; each sender's `not_checked` → `notChecked`, `checked_at` → `checkedAt`, `warmup_inbox` → `warmupInbox`, `warmup_score` → `warmupScore`, `warmup_spam` → `warmupSpam`, `warmup_spam_rate` → `warmupSpamRate`.
- A failing sender's `impact` in `sender_health` and `deliverability_check`: `active_campaign_count` → `activeCampaignCount`, `active_campaigns` → `activeCampaigns`, `last_authenticated_at` → `lastAuthenticatedAt`, `last_sent_on` → `lastSentOn`, `recent_sends` → `recentSends`, and the same names as keys of `impact.unknown`.
- Reply and message text wrapped as untrusted (`reply_samples`, `cross_channel_lead`, `vendor_read`, and `threadContext`'s `snippet`): `untrusted_content` → `untrustedContent`. The `UntrustedContent` type changes with it.

**Breaking: a failing sender's campaigns are listed once.** `impact.activeCampaigns` now holds campaign refs only, and each campaign appears once in a new top-level `campaigns` list of `sender_health` and `deliverability_check`, with `campaign`, `campaignName`, `provider` and `workspaceId`. Senders in a shared pool used to repeat the same campaigns under every failing sender.

**Every record says where it came from.** These rows now carry `provider` and `workspaceId` beside their ref: `campaign_overview` campaigns, `reply_samples` replies and `by: "person"` rows, `sender_health` and `deliverability_check` senders, `audience_lists` lists, `cross_channel_lead` timeline messages, and the `campaign_setup` and `lead_runway` answers. `outbound replies --by person` rows (`ReplyPerson`) carry them too: a person whose replies span two tools is one row, which names the first one's, as `leadRef` does.

**One step id.** A step is `stepIndex` (from 0) with `stepNumber` (from 1) for display, as the naming rule says. The bare `step` on `winning_steps` rows and on insight steps, `stepFunnel`'s `topStep` and `lastStepEarningPlace`, and `personSummary`'s `lastStep` and `repliedSteps` are still there as deprecated copies; removing them is left to its own change. They were due to go in 0.8.0.
