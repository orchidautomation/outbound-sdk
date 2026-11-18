# Metric field glossary

Where every count in a `MetricRow` comes from, for each adapter. One table per adapter, one row per count. `packages/outbound-sdk/test/metric-glossary-doc.test.ts` holds this file to the code: each table must list every count exactly once, and each vendor field it names must appear in that adapter's source.

Columns:

- **SDK field**: the `MetricRow` count.
- **Vendor API field**: the response field the adapter reads, on the adapter's campaign totals unless another report is named. `not reported` means the count is always `null`.
- **Vendor UI label**: the label the vendor's dashboard shows for the same number. Filled only where a parity case (`docs/vendor-parity.md`) recorded it; `not captured` otherwise.
- **Unit**: what the vendor field counts. `people` are distinct leads, `messages` are emails or LinkedIn messages and invitations, `events` are opens or clicks, so one message can have many. `money` is an amount in the vendor workspace's own currency. `(unverified)` means the vendor's documentation does not say and no parity case has settled it. `—` when the count is not reported.

An open or click count read from these fields is set to `null` when the campaigns behind the row did not measure it (tracking off with nothing recorded, or mixed tracking); the row's `tracking` field says why. The rule and its costs are in `site/content/docs/api/stats.mdx`, under "Opens and clicks that were not measured".

The SDK's own meaning of each count is in `packages/outbound-sdk/src/internal/metrics.ts`. Where the unit here differs from it (a `messages` count in a field the SDK defines as people), the adapter is wrong or the vendor offers nothing better; see the adapter's research note.

## Instantly

Campaign totals are `GET /campaigns/analytics/overview` (one campaign) and `GET /campaigns/analytics` (every campaign). Days are `GET /campaigns/analytics/daily` and `GET /accounts/analytics/daily`; steps are `GET /campaigns/analytics/steps`.

| SDK field | Vendor API field | Vendor UI label | Unit |
| --- | --- | --- | --- |
| `bounced` | `bounced_count`; by day and step `bounced` | not captured | messages |
| `clicked` | `link_click_count_unique`; by day and step `unique_clicks` | Click rate | people |
| `clickedTotal` | `link_click_count`; by day and step `clicks` | not captured | events |
| `completed` | `completed_count`, on totals only | not captured | people |
| `connectionsAccepted` | not reported | not captured | — |
| `connectionsSent` | not reported | not captured | — |
| `contacted` | `new_leads_contacted_count`; by day `new_leads_contacted`; per step `contacted`, the leads that step reached | Sequence started | people |
| `delivered` | not reported | not captured | — |
| `inmailsSent` | not reported | not captured | — |
| `leads` | `leads_count`, on the every-campaign report only (the overview has none) | Leads tab total | people |
| `meetingsBooked` | `total_meeting_booked`, on the overview only (one campaign's total and the workspace total) | not captured | people (unverified) |
| `opened` | `open_count_unique`; by day and step `unique_opened` | Open rate | people |
| `openedTotal` | `open_count`, on the overview only; by day and step `opened` | not captured | events |
| `opportunities` | `total_opportunities`, on totals only | Opportunities | people (unverified) |
| `opportunityValue` | `total_opportunity_value`, on totals only | Opportunities (value) | money |
| `positive` | `total_interested`, on the overview only | not captured | people |
| `replied` | `reply_count_unique`; by day and step `unique_replies` | Unique replies | people |
| `repliedAuto` | `reply_count_automatic_unique`; by day and step `unique_replies_automatic` | not captured | people |
| `repliedAutoTotal` | `reply_count_automatic`; by day and step `replies_automatic` | Replies (with repliedTotal) | messages |
| `repliedTotal` | `reply_count`; by day and step `replies` | Replies (with repliedAutoTotal) | messages |
| `sent` | `emails_sent_count`; by day and step `sent` | Total sent | messages |
| `unsubscribed` | `unsubscribed_count` | not captured | people |

The labels come from the 2026-11-15 parity case. "Sequence started" was copied from the dashboard as written (OUT-86); the others were recorded as keys (`totalSent`, `uniqueReplies`, `openRate`, `clickRate`, `leadsTotal`, `opportunities`, `opportunityValue`; the dashboard showed opportunities as "1 | $500"), so check their exact wording on the next capture. The dashboard's "Replies" (13 in that case) is reply messages, human and automatic together: `repliedTotal` (2) plus `repliedAutoTotal` (11). Its "Unique replies" (1) is `replied`, people.

## Smartlead

Campaign totals are `GET /campaigns/{id}/analytics` (lifetime) and `GET /campaigns/{id}/analytics-by-date` (a window). Workspace totals are `GET /analytics/overall-stats-v2`; steps are `GET /campaigns/{id}/sequence-analytics`.

| SDK field | Vendor API field | Vendor UI label | Unit |
| --- | --- | --- | --- |
| `bounced` | `bounce_count`; workspace `bounced` | not captured | messages |
| `clicked` | `unique_click_count` | not captured | people |
| `clickedTotal` | `click_count` | not captured | events |
| `completed` | not reported | not captured | — |
| `connectionsAccepted` | not reported | not captured | — |
| `connectionsSent` | not reported | not captured | — |
| `contacted` | `unique_sent_count`; workspace `unique_lead_count` | not captured | people |
| `delivered` | not reported | not captured | — |
| `inmailsSent` | not reported | not captured | — |
| `leads` | not reported | not captured | — |
| `meetingsBooked` | not reported | not captured | — |
| `opened` | `unique_open_count` | not captured | people |
| `openedTotal` | `open_count`; workspace and by day `opened` | not captured | events |
| `opportunities` | not reported | not captured | — |
| `opportunityValue` | not reported | not captured | — |
| `positive` | `campaign_lead_stats.interested`; workspace and by day `positive_replied`; per step `positive_reply_count` | not captured | people |
| `replied` | `reply_count`; in a window `non_ooo_reply_count`; workspace and by day `replied` | not captured | people (unverified) |
| `repliedAuto` | in a window `total_reply_count` minus `non_ooo_reply_count` | not captured | messages (unverified) |
| `repliedAutoTotal` | not reported | not captured | — |
| `repliedTotal` | not reported | not captured | — |
| `sent` | `sent_count`; workspace and by day `sent` | not captured | messages |
| `unsubscribed` | `unsubscribed_count` | not captured | people |

## HeyReach

Totals are `overallStats` of `POST /stats/GetOverallStats` and `POST /stats/GetOverallStatsByCampaign`; days are their `byDayStats`.

| SDK field | Vendor API field | Vendor UI label | Unit |
| --- | --- | --- | --- |
| `bounced` | not reported | not captured | — |
| `clicked` | not reported | not captured | — |
| `clickedTotal` | not reported | not captured | — |
| `completed` | not reported | not captured | — |
| `connectionsAccepted` | `connectionsAccepted` | not captured | people |
| `connectionsSent` | `connectionsSent` | not captured | messages |
| `contacted` | `uniqueLeadsContacted`, seen live, not in the API reference | not captured | people |
| `delivered` | not reported | not captured | — |
| `inmailsSent` | `inmailMessagesSent` | not captured | messages |
| `leads` | not reported | not captured | — |
| `meetingsBooked` | not reported | not captured | — |
| `opened` | not reported | not captured | — |
| `openedTotal` | not reported | not captured | — |
| `opportunities` | not reported | not captured | — |
| `opportunityValue` | not reported | not captured | — |
| `positive` | `autoTaggedInterested`, seen live, not in the API reference | not captured | people (unverified) |
| `replied` | `totalMessageReplies` plus `totalInmailReplies` | not captured | messages (unverified) |
| `repliedAuto` | not reported | not captured | — |
| `repliedAutoTotal` | not reported | not captured | — |
| `repliedTotal` | not reported | not captured | — |
| `sent` | `messagesSent` | not captured | messages |
| `unsubscribed` | not reported | not captured | — |

## EmailBison

Campaign and workspace totals are the summaries of `POST /api/campaigns/{id}/stats` and `GET /api/workspaces/v1.1/stats`; a sender's totals are its own record. Days are the line-area chart series; steps are `sequence_step_stats`.

| SDK field | Vendor API field | Vendor UI label | Unit |
| --- | --- | --- | --- |
| `bounced` | `bounced`; sender `bounced_count` | not captured | messages |
| `clicked` | not reported | not captured | — |
| `clickedTotal` | not reported | not captured | — |
| `completed` | not reported | not captured | — |
| `connectionsAccepted` | not reported | not captured | — |
| `connectionsSent` | not reported | not captured | — |
| `contacted` | `total_leads_contacted`; sender `total_leads_contacted_count`; per step `leads_contacted` | not captured | people |
| `delivered` | not reported | not captured | — |
| `inmailsSent` | not reported | not captured | — |
| `leads` | not reported | not captured | — |
| `meetingsBooked` | not reported | not captured | — |
| `opened` | `unique_opens_per_contact`; sender `unique_opened_count`; per step `unique_opens` | not captured | people |
| `openedTotal` | `opened`; sender `total_opened_count` | not captured | events (unverified) |
| `opportunities` | not reported | not captured | — |
| `opportunityValue` | not reported | not captured | — |
| `positive` | `interested`; sender `interested_leads_count` | not captured | people |
| `replied` | `unique_replies_per_contact`; sender `unique_replied_count`; per step `unique_replies` | not captured | people |
| `repliedAuto` | not reported | not captured | — |
| `repliedAutoTotal` | not reported | not captured | — |
| `repliedTotal` | not reported | not captured | — |
| `sent` | `emails_sent`; sender `emails_sent_count` | not captured | messages |
| `unsubscribed` | `unsubscribed` | not captured | people |
