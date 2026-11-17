# Smartlead API research

> This is the research record the Smartlead adapter was written from. The companion files it mentions (`endpoints.json`, `limits.json`, the full `fixtures/` set) were working files and are not in this repository; the fixtures used by the tests are in `fixtures/smartlead/`.

Fetched 2026-11-14 from public documentation only. No API calls were made and no credentials were used.

## Read this first: how reliable the docs are

Smartlead has three public sources and they disagree with each other.

| Source | What it is | Reliability |
| --- | --- | --- |
| `api.smartlead.ai` (Mintlify; `llms.txt`, `llms-full.txt`, 262 pages) | Current reference. | URLs, methods and parameters look reliable. Response examples are mixed: some are real ("Actual from API"), many are illustrative or placeholders (`{"ok": true, "data": []}`). Several endpoints have two pages with different response shapes. The "core" and "guides" pages contradict the reference pages. |
| `helpcenter.smartlead.ai` (`.md` per article, updated Oct to Nov 2026) | Support articles. | Most recent and most specific on rate limits, API keys, plan gating and webhook signing. |
| `help.smartlead.ai` Notion pages ("API Documentation [DEPRECATED]", "Webhook Guide Updated") | Original docs. | Marked deprecated, but the examples look like captured responses and the webhook guide is still linked from a help-center article updated 2026-11-12. |

There is no OpenAPI spec. `https://api.smartlead.ai/api-reference/openapi.json` returns the Mintlify sample "Plant Store" spec, not Smartlead's API.

Everything below marks which source a claim rests on. **Envelope shapes for several read endpoints are UNVERIFIED** and the adapter should accept both documented shapes until checked against a live key.

## Basics

- **Base URL:** `https://server.smartlead.ai/api/v1`. A legacy `/api/...` prefix exists "for backward compatibility"; do not use it.
- **Auth:** `api_key` query parameter on every request, e.g. `GET /campaigns/?api_key=<key>`. The help center states: "The key must be sent in the URL. A key sent in a request header is not accepted." The api.smartlead.ai authentication page also claims the key can go in a POST/PATCH body; UNVERIFIED and not needed.
- **Key types:**
  - Admin keys: account-wide, up to 25 per account, all share one rate-limit pool.
  - Client keys: scoped to one client (sub-account), own rate limit. Some endpoints reject client keys with `401` (lead search, lead campaign overview, sequence details, get client by id, assign client). `GET /campaigns/{id}` "additionally filters by client_id" for client keys.
- **Plan gating:** API access is "available on the Pro plan and higher. On Base and Popular plans, API Key Management is hidden." Wrong plan returns the text `API Key access denied`. Client workspaces are plan-gated too (listed under "not included" on lower plans; "3 client workspaces included" on Unlimited Prime).
- **Versioning:** only `v1`. No version header, no dated versions.
- **Sister services on other hosts**: `smartdelivery.smartlead.ai`, `prospect-api.smartlead.ai`, `smart-senders.smartlead.ai`, `smartservers.smartlead.ai`. Their reads are in the native catalog; see "Endpoint inventory" below.
- **IDs:** three different ids matter. `lead.id` (global lead), `campaign_lead_map_id` (a lead inside one campaign; also called `email_lead_map_id`, `sl_email_lead_map_id`, "lead map id", `lastSeenEclmId`), and `stats_id` (one sent email).
- **Timestamps:** ISO 8601, shown as UTC (`Z` or `+00:00`) in every example.

## 1. Campaigns

### List campaigns: `GET /campaigns/`

- Params: `client_id` (number), `include_tags` (boolean, default false).
- **No pagination.** Returns every campaign, newest first. No server-side status filter.
- Envelope: **bare array** (the docs stress "direct array of campaign objects (not wrapped)").
- Fields: `id`, `user_id`, `created_at`, `updated_at`, `status`, `name`, `track_settings` (array), `scheduler_cron_value` (`tz`, `days`, `startHour`, `endHour`), `min_time_btwn_emails`, `max_leads_per_day`, `stop_lead_settings`, `schedule_start_time`, `enable_ai_esp_matching`, `send_as_plain_text`, `follow_up_percentage`, `unsubscribe_text`, `parent_campaign_id` (non-null means this is a subsequence), `client_id`, `tags[]` (`tag_id`, `tag_name`, `tag_color`; only with `include_tags=true`).

### Get campaign: `GET /campaigns/{campaign_id}`

- Params: `include_tags`.
- Envelope UNVERIFIED. Legacy docs show a bare campaign object; the new example shows `{ "success": true, "data": {...} }` with fields (`sending_limit`, `total_leads`, `leads_contacted`, `leads_replied`) that appear nowhere else. The new page's prose says it returns a "single campaign object with all 18 CAMPAIGN_ATTRIBUTES fields", which matches the bare list shape.
- Also documents `auto_pause_domain_leads_reply_categories` (`null` or `{ category_ids: number[], include_uncategorised: boolean }`).

### Status values

| Value | Meaning | Where documented |
| --- | --- | --- |
| `DRAFTED` | Created, not started | reference pages, legacy docs |
| `ACTIVE` | Sending | all |
| `PAUSED` | Temporarily stopped | all |
| `STOPPED` | Permanently stopped | all |
| `ARCHIVED` | Hidden from active list | reference pages |
| `COMPLETED` | All leads processed | legacy docs, analytics-by-date page, core page |

The reference list page omits `COMPLETED`; the core page spells the draft state `DRAFT`. Treat the enum as the union of the six and map unknown values defensively. The write endpoint uses different verbs (`START`, `PAUSED`, `STOPPED`, `ARCHIVED`), which is irrelevant to a read-only SDK. `GET /analytics/campaign/status-stats` shows a `STARTED` status in its example, likely illustrative.

Other enums: `track_settings` values `DONT_EMAIL_OPEN`, `DONT_LINK_CLICK` (legacy also `DONT_REPLY_TO_AN_EMAIL`); `stop_lead_settings` values `REPLY_TO_AN_EMAIL`, `OPENED_EMAIL`, `CLICKED_LINK`, `NEVER` (legacy spells them `OPEN_AN_EMAIL`, `CLICK_ON_A_LINK`).

### Campaigns for a lead: `GET /leads/{lead_id}/campaigns`

Legacy docs only. Bare array of `{ id, status, name }`.

## 2. Sequences, steps, variants

`GET /campaigns/{campaign_id}/sequences`. No params beyond `api_key`.

- Envelope UNVERIFIED: page says "Response Format: array"; its example wraps it as `{ success, data: [...] }`; legacy shows unwrapped sequence objects.
- Step fields: `id`, `created_at`, `updated_at`, `email_campaign_id`, `seq_number` (1-based), `subject`, `follow_up_subject` (inherited subject for same-thread follow-ups; `null` when the step has its own), `email_body` (HTML), `seq_delay_details`, `sequence_variants[]`.
- Delay: the response field list says `seq_delay_details.delayInDays`; the write payload uses `seq_delay_details.delay_in_days`. Neither GET example shows the field. UNVERIFIED which casing comes back.
- Variant fields (legacy): `id`, `created_at`, `updated_at`, `is_deleted`, `subject`, `email_body`, `email_campaign_seq_id`, `variant_label` ("A", "B", "C"). The new example uses `variant_name` ("Variant A") instead. `sequence-analytics` uses `variant_label`, so `variant_label` is the better bet.
- When variants exist the step-level `subject` / `email_body` can be empty strings and the copy lives in the variants.
- An empty `subject` on step 2+ means "send in the same thread".
- Step types beyond email exist: `sequence-analytics` returns `seq_type` (e.g. `EMAIL`), `seq_schedule_type` (`IMMEDIATE`; lead search mentions `MANUAL` / `AUTO`), `linkedin_stats`, `manual_step_stats`.

## 3. Senders (email accounts)

### List: `GET /email-accounts/`

- Pagination: `offset` (default 0), `limit` (default 100, **max 100**). No total and no next marker; stop when a page is shorter than `limit`.
- Filters: `isInUse`, `emailWarmupStatus` (`ACTIVE` | `INACTIVE`), `isSmtpSuccess`, `isWarmupBlocked`, `esp` (`GMAIL` | `OUTLOOK` | `SMTP`), `username` (partial), `client_id`, `fetch_campaigns=true` (adds `campaign_ids[]`).
- Envelope: bare array.
- Fields: `id`, `created_at`, `updated_at`, `user_id`, `from_name`, `from_email`, `username`, `type` (`GMAIL` | `OUTLOOK` | `SMTP`; legacy adds `ZOHO`), `client_id`, `campaign_count`, `message_per_day` (daily limit), `daily_sent_count`, `minTimeToWaitInMins`, `is_smtp_success`, `is_imap_success`, `smtp_failure_error`, `imap_failure_error`, `smtp_host`, `smtp_port`, `smtp_port_type`, `imap_host`, `imap_port`, `imap_port_type`, `imap_username`, `is_different_imap_account`, `signature`, `custom_tracking_domain`, `bcc_email`, `different_reply_to_address`, `tags[]`, `warmup_details`.
- `warmup_details` (list): `status` (`ACTIVE` | `INACTIVE` | `PAUSED`), `total_sent_count`, `total_spam_count`, `warmup_reputation` (string such as `"95%"`), `warmup_key_id`, `warmup_created_at`, `reply_rate`, `blocked_reason`. Can be `null`.
- **Security:** the response includes `password` and `imap_password` (base64 in the list, decoded in get-by-id). The SDK must drop these fields and never log raw responses.
- There is no single "status" field. Derive it from `is_smtp_success`, `is_imap_success` and `warmup_details.status`.

### Get: `GET /email-accounts/{email_account_id}/`

Same fields plus extended `warmup_details`: `id`, `created_at`, `warmup_max_count`, `warmup_min_count`, `is_warmup_blocked`, `max_email_per_day`, `warmup_reputation` (shown as number `95` here, string `"95%"` / `"100%"` in the list and legacy docs; handle both). `warmup_key_id` is a number in the new example and a string (`"brass-sleep"`) in legacy. Note the trailing slash in the documented path. Param `fetch_campaigns`.

### Warmup stats: `GET /email-accounts/{email_account_id}/warmup-stats`

Last 7 days, no params. Field names UNVERIFIED:

- Legacy: `id`, `sent_count`, `spam_count`, `inbox_count`, `warmup_email_received_count` (all strings), `stats_by_date[]` of `{ id, date, sent_count, reply_count, save_from_spam_count }`.
- New docs: `total_sent`, `spam_count`, `reputation_score`, `daily_stats[]` of `{ date, sent, spam, delivered, opened, replied }`.

### Per campaign: `GET /campaigns/{campaign_id}/email-accounts`

Param `include_tags`. Envelope UNVERIFIED (legacy bare array of full account objects without passwords; new example `{ ok, data: [...] }` with invented-looking fields such as `"warmup_reputation": "excellent"`).

No LinkedIn accounts or seats are exposed by this API.

## 4. Leads

There is **no global "list all leads" endpoint**. Leads are listed per campaign, looked up by email or id, or reached through lead lists.

### List per campaign: `GET /campaigns/{campaign_id}/leads`

- Pagination: `offset` (default 0), `limit` (default 100, **max 100**). Response echoes `offset`, `limit` and gives `total_leads` (a **string** in the newer example, a number in legacy).
- Filters: `status`, `lead_category_id`, `emailStatus` (`is_opened`, `is_clicked`, `is_replied`, `is_bounced`, `is_unsubscribed`, `is_spam`, `is_accepted`, `not_replied`, `is_sender_bounced`), `created_at_gt`, `last_sent_time_gt`, `event_time_gt` (ISO 8601).
- Envelope: `{ total_leads, offset, limit, data: [...] }`.
- Row: `campaign_lead_map_id`, `lead_category_id` (null when uncategorized), `status`, `created_at`, `lead` object with `id`, `email`, `first_name`, `last_name`, `phone_number`, `company_name`, `website`, `location`, `linkedin_profile`, `company_url`, `custom_fields` (free-form object), `is_unsubscribed`, `unsubscribed_client_id_map`.
- A duplicate doc page (`campaigns/get-leads`) shows a different envelope (`{ total, leads }` with `category_name`, `email_stats`). It conflicts with both the other page and legacy; treated as wrong.

### Lead status values

`STARTED` (scheduled, first email not sent), `INPROGRESS` (at least one email sent), `COMPLETED` (sequence finished or replied), `PAUSED`, `STOPPED`, `BLOCKED` (bounced or on the block list). `BLOCKED` is accepted by the search endpoint and listed in legacy docs but not in the list endpoint's filter values. Inactive mappings in `campaign-overview` return the literal string `"XXX"` for status and several other fields.

### Search (POST-for-read): `POST /campaigns/{campaignId}/leads/filter`

Admin key only. Body filters (`searchText`, `leadStatuses[]`, `emailStatuses[]`, `leadCategoryIds[]`, `emailAccountIds[]`, `sequenceNumbers[]`, `statusFilter`, `fieldSet`...). **Cursor pagination**: send the previous response's `lastSeenEclmId` as `lastSeenLeadId`; `limit` default 25, max 100; ordered by lead map id ascending. Response `{ leads, lastSeenEclmId, lastSeenReplyTime?, count }`. With `fieldSet: "active_table"` rows add `next_timestamp_to_reach`, `last_sent_time`, `latest_reply_time`, `email_campaign_seq_id`, `lead_category_id`, `lead_category { id, name }`, `latest_email_stats`, `latest_reply_stats`, `matched_status_stats`.

### Lookups

- `GET /leads/?email=` returns the lead plus `created_at` and `lead_campaign_data[]` (`campaign_lead_map_id`, `campaign_id`, `campaign_name`, `client_id`, `client_email`, `lead_category_id`). Returns `{}` with HTTP 200 when not found.
- `GET /leads/{lead_id}`: example looks illustrative. UNVERIFIED.
- `GET /leads/{leadId}/campaign-overview` (admin key only): `{ ok, message, data }` with `email_campaign_leads_mappings[]` (`id` = lead map id, `status`, `lead_category_id`, `revenue`, `current_seq_num`, `next_timestamp_to_reach`, `email_campaign_id`, `email_account_id`, `is_active`, `email_campaign { id, name, status, sequence_count }`). Numeric ids come back as strings here.
- `GET /leads/{leadMapId}/sequence-details` (admin key only; optional `campaignId`): per-step send status (`status`, `sent_time`, `status_message`, `email_campaign_seq_id`).
- `GET /campaigns/{campaign_id}/leads-export`: CSV with `open_count`, `click_count`, `reply_count`, `category`, `is_interested`, `last_email_sequence_sent`.
- `GET /lead-list/` (lead lists): `{ ok, data: [ { id, name, lead_count, created_at } ] }`, `limit` / `offset` with no documented maximum.

Custom fields: free-form `custom_fields` object on the lead. Help center: up to 200 custom fields per lead (legacy said 20).

## 5. Messages (sent and received)

Bodies **are** returned by the endpoints below.

### Per lead: `GET /campaigns/{campaign_id}/leads/{lead_id}/message-history`

- Params: `event_time_gt` (ISO 8601), `show_plain_text_response` (boolean).
- Envelope UNVERIFIED. Legacy (and the webhook `history` array, which has the same item shape): `{ history: [ { type: "SENT" | "REPLY", message_id, stats_id, time, email_body, subject } ], from, to }`. `subject` is absent on replies. New example `{ messages: [ { id, subject, direction, sent_at, ... } ] }` looks illustrative.
- `lead_id` is the global lead id, not the map id.

### Bulk (POST-for-read): `POST /campaigns/{campaign_id}/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL`

The random-looking suffix is literally part of the documented path. Body `{ "lead_ids": [..] | null }` (null = all leads), query `event_time_gt`. Response keyed by lead id; item shape UNVERIFIED.

### Per campaign, one row per sent email: `GET /campaigns/{campaign_id}/statistics`

- Pagination `offset`, `limit` (default 100, **max 1000**); response `{ total_stats (string), data, offset, limit }`.
- Filters: `email_sequence_number` (1 to 20), `email_status` (`opened` | `clicked` | `replied` | `unsubscribed` | `bounced`), `sent_time_start_date`, `sent_time_end_date` (format `2023-10-16 10:33:02.000Z`).
- Row (legacy + new field list): `lead_name`, `lead_email`, `lead_category`, `sequence_number`, `email_campaign_seq_id`, `seq_variant_id`, `email_subject`, `email_message`, `sent_time`, `open_time`, `click_time`, `reply_time`, `open_count`, `click_count`, `is_unsubscribed`, `is_bounced`, plus `is_opened`, `is_clicked`, `is_replied`, `sender_bounce` in the new field list.
- The two api.smartlead.ai pages for this URL show aggregate-looking examples that contradict their own field list. Envelope UNVERIFIED; legacy shape judged correct.
- No lead id in the row; join on `lead_email`.

### Across all campaigns: `GET /campaigns/all-leads-activities`

- Pagination `offset`, `limit` (default 100, **max 1000**); response `{ data, hasMore }`.
- Date filters `event_time_from`, `event_time_to` (ISO 8601 or `YYYY-MM-DD`; `to` requires `from`).
- **Dedicated limit: 10 requests / 60 s.**
- Row: `lead_id`, `email_lead_map_id`, `campaign_id`, `campaign_name`, `campaign_status`, `status`, `current_seq_num`, `created_at`, `activities[]` of `{ stats_id, message_id, subject, email_body, sent_time, from_email, to_email, email_seq_number, open_count, click_count, click_details, reply_details { time, reply_email_body, message_id } | null, thread_replies[] }`.
- This is the best incremental sync source for messages and replies. A duplicate doc page shows a flat event shape (`activity_type`, `event_time`); treated as wrong.

## 6. Replies and categories

### Category list: `GET /leads/fetch-categories`

Bare array of `{ id, name, sentiment_type, created_at }`. `sentiment_type` is `positive`, `negative` or `null`. Global categories have low ids and are read-only; custom categories have higher ids. Legacy lists the global set as: 1 Interested, 2 Meeting Request, 3 Not Interested, 4 Do Not Contact, 5 Information Request, 6 Out Of Office, 7 Wrong Person. The new example shows different names for ids 2 and 3, so **do not hardcode ids; always fetch the list** and use `sentiment_type` for "positive".

A lead has one category per campaign (`lead_category_id` on the campaign-lead mapping). It reflects the most recent categorization and is mutable, which changes historical "positive" counts.

### Master inbox (all POST-for-read)

| Endpoint | Purpose |
| --- | --- |
| `POST /master-inbox/inbox-replies` | All replies. Query `fetch_message_history` (default false). |
| `POST /master-inbox/unread-replies` | Unread only |
| `POST /master-inbox/sent` | Sent emails |
| `POST /master-inbox/important`, `/assigned-me`, `/archived`, `/snoozed`, `/reminders`, `/scheduled`, `/views` | Other folders |
| `GET /master-inbox/{id}` | One thread; `id` is the `campaign_lead_map_id` |
| `GET /master-inbox/untracked-replies` | Replies not matched to a lead; `limit` 1 to 100 (default 20), `offset`, `fetchBody`, `fetchAttachments`, `from_email`, `to_email`, `subject_line` |
| `GET /master-inbox/reply-status?message_id=` | Delivery status of a reply sent through the API |

- Body: `offset` (default 0), `limit` (default 20, **max 20**), `filters`, `sortBy` (`REPLY_TIME_DESC` default, `SENT_TIME_DESC`).
- `filters`: `search` (max 30 chars), `leadCategories { unassigned, isAssigned, categoryIdsIn[<=10], categoryIdsNotIn[<=10] }`, `emailStatus` (`Opened`, `Clicked`, `Replied`, `Unsubscribed`, `Bounced`, `Accepted`, `Not Replied`), `campaignId` (max 5 on inbox-replies and unread; max 15 on sent), `emailAccountId` (max 20 on inbox-replies, 10 on unread), `campaignTeamMemberId`, `campaignTagId`, `campaignClientId` (max 10 each), `replyTimeBetween` (`[startISO, endISO]`).
- Response example `{ messages, total_count, offset, limit }`. **The item shape in the docs looks illustrative (ids like `msg_xyz789`); UNVERIFIED.** Do not model item fields from it without a live check.
- Page size 20 makes the master inbox slow for bulk sync. Prefer `all-leads-activities` or per-campaign `statistics?email_status=replied` plus `message-history`.

No sentiment score beyond category `sentiment_type`. Out-of-office is a category; `analytics-by-date` exposes `non_ooo_reply_count`.

## 7. Analytics

### Per campaign totals: `GET /campaigns/{campaign_id}/analytics`

Bare object, counts as **strings** (legacy docs and help-center article 122): `id`, `user_id`, `created_at`, `status`, `name`, `sent_count`, `open_count`, `click_count`, `reply_count`, `block_count`, `total_count`, `drafted_count`, `bounce_count`, `unsubscribed_count`, `sequence_count`, `unique_open_count`, `unique_click_count`, `unique_sent_count`, `tags[]`, `client_id`, `client_name`, `client_email`, `parent_campaign_id`, `campaign_lead_stats { total, blocked, stopped, completed, inprogress, notStarted, paused, interested, unsubscribed_count }` (the last three are from article 122), plus `send_as_plain_text` and `track_settings`. `campaign_lead_stats.interested` is the positive count (leads in a positive-sentiment category). The api.smartlead.ai pages for this URL show only placeholders.

Article 122's rate formulas: open rate = `unique_open_count / unique_sent_count`; reply rate = `reply_count / unique_open_count`, or `/ unique_sent_count` for plain-text or open-tracking-off campaigns; positive reply rate = `campaign_lead_stats.interested / reply_count`.

### Per campaign, date window: `GET /campaigns/{campaign_id}/analytics-by-date`

- Params: `start_date`, `end_date` (`YYYY-MM-DD`, required), `time_zone` (IANA, default `UTC`). **Range max 30 days**; wider returns 400 `{"error": "Invalid start_date & end_date range. Date difference should be max of 30days."}`.
- Returns one totals object for the window, **not per-day rows**. Per-day data needs one call per day.
- Fields (all strings): `sent_count`, `unique_sent_count`, `open_count`, `unique_open_count`, `click_count`, `unique_click_count`, `reply_count` (excludes ignored replies), `total_reply_count`, `non_ooo_reply_count`, `block_count`, `bounce_count`, `unsubscribed_count`, `total_count` and `drafted_count` (both lifetime, not windowed), plus `id`, `user_id`, `created_at`, `status`, `name`, echoed `start_date`, `end_date`.
- `GET /campaigns/{campaign_id}/top-level-analytics-by-date` (same date params) documents `sender_bounce_count`; response otherwise undocumented.

### Per step and variant: `GET /campaigns/{campaign_id}/sequence-analytics`

`start_date`, `end_date` required, **ISO 8601 datetimes** here (not `YYYY-MM-DD`), `time_zone`. Response `{ ok, data: { campaign_id, sequences[] } }`; each sequence has `total_stats` and `variants[].stats` with `sent_count`, `open_count`, `click_count`, `reply_count`, `bounce_count`, `sender_bounce_count`, `unsubscribed_count`, `skipped_count`, `positive_reply_count`, and `*_percentage` rates. Best-documented stats endpoint.

### Per sender

- `GET /campaigns/{campaign_id}/mailbox-statistics`: `client_id`, `offset`, `limit` (max 20), `start_date`, `end_date`, `time_zone`. Response undocumented (placeholder).
- `GET /analytics/mailbox/name-wise-health-metrics`: account-wide, `{ ok, data: { email_health_metrics: [ { email_account, sent, opened, replied, bounced } ] } }`.

### Per lead: `GET /campaigns/{campaign_id}/leads-statistics`

`limit` (max 100), `offset`, `event_time_gt` (`YYYY-MM-DD`). Response undocumented. **Dedicated limit 10 requests / 60 s** shared across all campaigns.

### Global analytics (`/analytics/...`)

Common params: `start_date`, `end_date` (`YYYY-MM-DD`, inclusive both ends), `timezone` (note: **`timezone`** here, **`time_zone`** on the `/campaigns/...` endpoints), `client_ids`, `campaign_ids` (comma-separated).

| Endpoint | Returns |
| --- | --- |
| `GET /analytics/overall-stats-v2` | `{ success, message, data: { overall_stats } }`: `sent`, `opened`, `replied`, `bounced`, `unique_lead_count`, `unique_open_count` (strings), `positive_replied` (number), `open_rate`, `reply_rate`, `positive_reply_rate`, `bounce_rate` (strings like `"0.58%"`) |
| `GET /analytics/day-wise-overall-stats` | `data.day_wise_stats[]` of `{ date, sent, opened, replied, bounced }`; each metric on its own event date; `bounced` / `unsubscribed` are always 0 here |
| `GET /analytics/day-wise-overall-stats-by-sent-time` | Same, everything attributed to send date; use this for daily bounces |
| `GET /analytics/day-wise-positive-reply-stats` (and `-by-sent-time`) | `{ date, positive_replied }` |
| `GET /analytics/campaign/overall-stats` | `data.campaign_wise_performance[]` per campaign; `limit`, `offset` |
| `GET /analytics/client/overall-stats` | `data.client_wise_performance[]` per client with `campaign_stats` |
| `GET /analytics/lead/category-wise-response` | `data.lead_responses_by_category[]` of `{ category, total_response, percentage }` |
| `GET /analytics/campaign/list`, `/analytics/client/list` | `{ id, name }` selectors |

Other documented `/analytics/...` endpoints not read in detail: `campaign/response-stats`, `campaign/status-stats`, `campaign/follow-up-reply-rate`, `campaign/lead-to-reply-time`, `campaign/leads-take-for-first-reply`, `lead/overall-stats`, `mailbox/overall-stats`, `mailbox/domain-wise-health-metrics` (dedicated 10/60 s limit), `mailbox/provider-wise-overall-performance`, `client/month-wise-count`, `team-board/overall-stats`.

Counting rules (from "How Analytics Metrics Are Calculated"): raw counts (`sent`, `opened`, `replied`, `bounced`) are additive; unique counts and `positive_replied` are distinct-lead counts and **cannot be summed across days**. `open_rate = unique_open_count / unique_lead_count`. `reply_rate = replied / unique_open_count` (falls back to `unique_lead_count` when open tracking is off). `positive_reply_rate = positive_replied / replied`. `bounce_rate = bounced / unique_lead_count`. "Positive" = lead whose category has `sentiment_type = 'positive'` with a genuine reply.

Counts available: sent, unique sent, opened total and unique, clicked total and unique, replied, positive, bounced, sender-bounced, unsubscribed, blocked. **No "delivered" count** in the well-documented endpoints. No LinkedIn counts except `linkedin_stats` inside `sequence-analytics` (shape undocumented).

## 8. Clients (sub-accounts, white label)

- `GET /client/`: all clients of the account. Envelope UNVERIFIED (legacy bare array; new example `{ ok, data }`). Legacy fields: `id`, `name`, `email`, `uuid`, `created_at`, `user_id`, `logo`, `logo_url`, `client_permision { permission[], retricted_category[] }` (both misspellings are literal). No pagination documented.
- `GET /client/{id}` (admin key only): `{ ok, data }` with opt-in `includePermissions`, `includeCredits`, `includeCodeIntegrations`, `includeWhitelabel`. Here the key is `client_permissions` (array), still with `retricted_category`.
- `GET /client/api-key`: list client keys (`clientId`, `status`, `keyName`).
- **How `client_id` ties things together:** each campaign has a nullable `client_id` (subsequences inherit it); email accounts have a nullable `client_id`. Filter with `GET /campaigns/?client_id=`, `GET /email-accounts/?client_id=`, `client_ids=` on `/analytics/...`, `filters.campaignClientId` in the master inbox. Webhook payloads carry `client_id`. A lead's unsubscribe state is per client (`unsubscribed_client_id_map`).
- One admin key sees every client. One client key sees only its client. There is no separate "workspace" concept above clients. The help center says each client can have one API key; the api.smartlead.ai page says several per client (conflict, not relevant to reads).

## 9. Webhooks

### Registration

| Endpoint | Notes |
| --- | --- |
| `POST /webhook/create` | Body `webhook_url`, `association_type` (`user` \| `client` \| `campaign`; the core page uses 1 / 2 / 3), `email_campaign_id` or `client_id`, `name`, `event_type_map` (`{ EVENT: true }`), `category_id_map`, `force_create`. Returns `{ ok, id, webhook_url }`. |
| `GET /webhook/{webhook_id}` | `{ ok, data }` with `event_type_map`, `category_id_map` |
| `PUT /webhook/update/:webhook_id` | Body `name`, `webhook_url`, `event_types[]`, `categories[]` |
| `DELETE /webhook/delete` | Body `{ id }` |
| `GET /campaigns/{campaign_id}/webhooks` | Campaign webhooks (legacy shape with `event_types[]`, `categories[]` by name) |
| `POST /campaigns/{campaign_id}/webhooks` | Upsert (`id: null` creates) |
| `GET /campaigns/{campaignId}/webhooks/summary`, `POST .../retrigger-failed-events` | Delivery summary and manual retry |
| `POST /webhook/{id}/signing-secret` (`?rotate=true`), `DELETE /webhook/{id}/signing-secret` | Turn HMAC signing on / off; 409 if JWT is on unless `{"replace_other_method": true}` |

No documented endpoint lists all webhooks of an account. `llms.txt` advertises `GET /webhooks` and `POST /webhooks`, which no reference page backs.

**Precedence trap:** only one webhook fires per event. A user-level webhook overrides client- and campaign-level ones; among several at the same level, the last updated wins.

Plan gating for webhooks is not documented (API access itself needs Pro or higher).

### Event types

`EMAIL_SENT`, `FIRST_EMAIL_SENT`, `EMAIL_OPEN`, `EMAIL_LINK_CLICK`, `EMAIL_REPLY`, `EMAIL_BOUNCE`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED`, `CAMPAIGN_STATUS_CHANGED`, `UNTRACKED_REPLIES`, `MANUAL_STEP_REACHED`. Separate per-user settings (not the campaign webhook system): `EMAIL_ACCOUNT_DISCONNECTED`, `LINKEDIN_DISCONNECTED`, and bounce auto-pause.

The names `EMAIL_OPENED`, `EMAIL_REPLIED`, `EMAIL_CLICKED`, `EMAIL_BOUNCED`, `LEAD_REPLIED` etc. that appear in the core page, the update page and the campaign-webhook page are **not** the real event names.

### Payload shape

Flat JSON object, discriminator `event_type`. Source: the Notion webhook guide (fixtures `webhook.<EVENT>.json`). Shared fields: `webhook_id`, `webhook_name`, `webhook_url`, `event_type`, `event_timestamp`, `campaign_id`, `campaign_name`, `campaign_status`, `client_id`, `secret_key`, `app_url`, `description`, `metadata.webhook_created_at`. Each payload carries both deprecated and replacement fields.

| Event | Specific fields |
| --- | --- |
| `EMAIL_SENT` | `stats_id`, `sl_email_lead_id`, `sl_email_lead_map_id`, `from_email`, `to_email`, `to_name`, `subject`, `sequence_number`, `sent_message { message_id, html, text, time }`; deprecated `time_sent`, `custom_subject`, `custom_email_message`, `sent_message_body`, `message_id`, `ui_master_inbox_link` |
| `EMAIL_OPEN` | as sent; deprecated `time_opened` |
| `EMAIL_LINK_CLICK` | as sent, plus `link_details[]`; deprecated `link_clicked[]`, `time_clicked` |
| `EMAIL_REPLY` | as sent, plus `sl_lead_email`, `reply_message { message_id, html, text, time }`, `reply_category`; `stats_thread_id` on threaded replies; deprecated `time_replied`, `reply_body`, `preview_text`, `message_id` |
| `EMAIL_BOUNCE` | as sent, plus `bounce_message { message_id, html, text, time }`; deprecated `is_bounced`, `bounce_reply_message_id`, `bounce_reply_email`, `bounce_reply_email_preview` |
| `LEAD_UNSUBSCRIBED` | `to_email`, `to_name`, `from_email`, `sequence_number`, `sent_message`, `unsubscribed_client_id_map`; deprecated `lead_email`, `lead_name` |
| `LEAD_CATEGORY_UPDATED` | `lead_id`, `lead_category { old_id, old_name, new_id, new_name }`, `lead_data { email, first_name, last_name, phone_number, company_name, website, location, custom_fields, linkedin_profile, company_url, category { name, sentiment_type } }`, `history[]` (`stats_id`, `type` SENT/REPLY, `message_id`, `time`, `email_body`, `subject`), `last_reply`; deprecated `category`, `lead_category_id`, `lead_email`, `lead_name`, `from`, `to`, `lastReply` |
| `CAMPAIGN_STATUS_CHANGED` | `previous_status`, `current_status` |
| `UNTRACKED_REPLIES` | `reply_message`, `sender_detail`, `recipient_detail`, `cc`, `bcc`, `subject`, `visible_text`, `has_attachment`; no campaign fields |
| `MANUAL_STEP_REACHED` | `lead_name`, `lead_id` (string), `lead_email`, `sent_message_ids[]`, `current_sequence_number` |

Notes: `from_email` is always the sending mailbox and `to_email` the lead, even on a reply. The example payloads omit `sl_email_lead_id` / `sl_email_lead_map_id` although the structure lists them, so most events may not carry a lead id; match on `to_email` + `campaign_id`. The `EMAIL_REPLY` example also omits `reply_category`. Test events carry `"is_test": true`. The two help-center samples for account disconnect and bounce threshold use a different envelope (`id`, `type`, `created_at`, `data`, `links`, `meta`).

### Verification

Three mechanisms are documented. Only the first two are recent and detailed.

1. **Signing secret, Standard Webhooks format** (help-center article 470, updated 2026-11-06). Off by default, enabled per webhook. Secret starts with `whsec_` (base64, 24 to 64 bytes). Headers `webhook-id` (stable across retries), `webhook-timestamp` (Unix seconds), `webhook-signature` (`v1,<base64>`). Verify over the raw body with the `standardwebhooks` library. Slack webhooks cannot be signed.
2. **JWT** (article 481). `Authorization: Bearer <jwt>` plus `webhook-id`. ES256, per-webhook public JWK, `iss` = `https://smartlead.ai`, `aud` = `smartlead:webhook:<webhook id>`, `exp` = `iat` + 300, and a `body_sha256` claim to compare with the SHA-256 of the raw body. Mutually exclusive with the signing secret. App-only, cannot be managed by API key.
3. **Legacy `secret_key` in the body.** Present in every payload; the help center says it "doesn't prove where a request came from".

`X-Smartlead-Signature: sha256=...`, `X-Request-Id` and `X-Webhook-Level` are described in article 403 and the api.smartlead.ai webhook guide, with no statement of where that secret comes from. They conflict with the newer `webhook-*` headers. UNVERIFIED; treat as possibly not sent.

### Delivery

Up to 8 attempts over about 28 hours; no retry on `400`, `413`, `422`; 60 s timeout per request; reply `401` (not `400`) on a bad signature so it is retried. The core page's "5 retries then disabled" schedule is contradicted and should be ignored.

## 10. Key check ("whoami")

**Not available.** No endpoint returns account or key identity. Cheapest validity probes: `GET /leads/fetch-categories` or `GET /campaigns/` (unpaginated, can be large). Invalid key returns `401 {"message": "Invalid API Key"}`. Key type (admin vs client) cannot be read directly; an admin-only endpoint returning `401` for an otherwise valid key implies a client key.

## Rate limits

See `limits.json`.

| Limit | Scope | Source |
| --- | --- | --- |
| 200 requests / minute (default) | Account: all admin keys share it | Help center article 68, updated 2026-11-12 |
| 60 requests / minute (default) | Each client API key | Articles 68 and 430 |
| 10 requests / 60 s | `GET /campaigns/{id}/leads-statistics`, `GET /campaigns/all-leads-activities`, `GET /analytics/mailbox/domain-wise-health-metrics`, each with its own counter, on top of the account limit | api.smartlead.ai rate-limit guide and endpoint pages |

Conflicts:

- The api.smartlead.ai guide's tier table (Standard 60/min + 1,000/hour + 10/s burst; Pro 120/min + 3,000/hour + 20/s burst; Enterprise custom) is contradicted by the help center and looks generic. UNVERIFIED.
- The "60 per 60 seconds" figure matches the client-key 429 text `You have exceeded the 60 requests in 1 min limit!`.
- Legacy docs: "10 requests every 2 seconds".

429 behaviour: the help center quotes three literal messages (see `fixtures/error.429.*.txt`); a 429'd call is not processed. For the endpoint-specific limits the window is fixed, starting at the first request and resetting 60 s later, and the 429 is plain text with **no** `Retry-After` or `X-RateLimit-*` headers. Whether account-level 429s send `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` or the JSON body shown in the guide is UNVERIFIED.

## Errors

| Status | Documented body |
| --- | --- |
| 400 | `{"error": "..."}`; some `{"error": "...", "status": "error"}` |
| 401 | `{"message": "Invalid API Key"}`; also text "API key is required." and "API Key access denied" (plan) |
| 404 | `{"error": "Campaign not found - Invalid campaign_id."}`, `{"error": "Email account not found"}`, `{"message": "Client not found or does not belong to the user"}`, `{"ok": false, "error": "..."}` |
| 422 | `{"error": "limit must be less than or equal to 100"}` |
| 429 | Plain text (see above) |
| 500 | `{"message": "..."}` or `{"ok": false, "message": "..."}`; note assign-client reports validation failures as 500 |

There is no single error envelope. The structured shapes in the guides (`{ error: { code, message, details } }`, `{ success: false, error: { code: "UNAUTHORIZED" } }`) appear in no reference page; UNVERIFIED. Parse errors by trying `message`, then `error` (string or object), then raw text.

## Changelog (last ~6 months)

Smartlead publishes no API changelog (`/changelog` returns 404). Dated or clearly recent items found; most carry no date, so "recent" is inferred from article update dates:

- Webhook signing with a `whsec_` secret (Standard Webhooks) and JWT authentication; articles updated 2026-11-06.
- Multiple admin API keys (up to 25) sharing one account rate limit; client-level API keys with their own 60/min limit.
- Retry policy stated as 8 attempts over about 28 hours.
- `analytics-by-date` documents `total_reply_count` and `non_ooo_reply_count`; statistics document `sender_bounce` / `sender_bounce_count`.
- Endpoints with detailed, recent-looking pages: `sequence-analytics`, `leads/filter` (cursor search), `campaign-overview`, `sequence-details`, lead category create / update / delete, dedicated 10/min limits on three endpoints.
- `PATCH /master-inbox/mark-unread` deprecated after 2025-08-14 in favour of `change-read-status`.
- Help-center API articles were all touched between 2026-10-01 and 2026-11-13.

## Unverified / unclear

1. Response envelope of `GET /campaigns/{id}`, `/campaigns/{id}/sequences`, `/campaigns/{id}/email-accounts`, `/campaigns/{id}/statistics`, `/campaigns/{id}/webhooks`, `/client/` (bare vs `{ ok | success, data }`).
2. `message-history` shape (`history[]` + `from` / `to` vs `messages[]`).
3. Master inbox item fields, `GET /master-inbox/{id}` and untracked-replies item fields.
4. Response shape of `leads-statistics`, `mailbox-statistics`, `top-level-analytics-by-date`, bulk message history, `GET /leads/{lead_id}`.
5. Warmup stats field names; `warmup_reputation` type (string percent vs number); `warmup_key_id` type.
6. Sequence delay field casing on read (`delayInDays` vs `delay_in_days`) and variant label key (`variant_label` vs `variant_name`).
7. Whether `COMPLETED` is still a campaign status and whether `DRAFTED` is ever spelled `DRAFT`.
8. `total_leads` / `total_stats` type (string vs number).
9. Account-level 429: headers and body format; whether any `X-RateLimit-*` header exists.
10. Whether `X-Smartlead-Signature`, `X-Request-Id`, `X-Webhook-Level` are sent at all.
11. Whether webhook payloads include `sl_email_lead_id` / `sl_email_lead_map_id` in practice, and the `FIRST_EMAIL_SENT` and `EMAIL_ACCOUNT_DISCONNECTED` payloads.
12. Which endpoints accept a client API key beyond those explicitly marked admin-only.
13. Maximums for `limit` on `/lead-list/` and the `/analytics/.../overall-stats` endpoints; behaviour of `full_data=true`.
14. Timezone of timestamps without an offset (examples are UTC `Z` or `+00:00`).
15. Plan gating for webhooks and for the global analytics endpoints.
16. Whether `api_key` in a request body works.
17. Body parameters of the secondary master-inbox folders (`important`, `assigned-me`, `archived`, `snoozed`, `reminders`, `scheduled`, `views`): assumed to match `inbox-replies`; those pages were not read in detail.

## Read parity (added 2026-11-14)

Written for the account-level reads the core gained. Fetched fresh on 2026-11-14: `https://api.smartlead.ai/llms-full.txt` (every reference page in one file), `https://api.smartlead.ai/llms.txt`, `https://helpcenter.smartlead.ai/llms.txt` and help-center articles 122, 184 and 185. No API call was made; there is no key.

Which source was followed: the **reference pages on `api.smartlead.ai`** for URLs, methods and parameters. For a response shape, the page's example when it looks captured (block list, tags, lead lists, campaign list), and the older Notion shape when the newer example is illustrative or a placeholder (campaign webhooks, warmup statistics, message history). Where both shapes are plausible the adapter reads both.

### Campaign settings: `GET /campaigns/{campaign_id}`

- Fields used: `scheduler_cron_value { tz, days, startHour, endHour }` (one window; days are 0 Sunday to 6 Saturday), `min_time_btwn_emails` (minutes), `max_leads_per_day`, `track_settings`, `stop_lead_settings`, `send_as_plain_text`, `schedule_start_time`, `sending_limit`, `out_of_office_detection_settings.ignoreOOOasReply`.
- `track_settings` lists what is not tracked: `DONT_EMAIL_OPEN`, `DONT_LINK_CLICK` on a read; the settings update spells them `DONT_TRACK_EMAIL_OPEN`, `DONT_TRACK_LINK_CLICK`. Both are read.
- `stop_lead_settings`: `REPLY_TO_AN_EMAIL` is stop-on-reply, `NEVER` is not. `OPENED_EMAIL` / `CLICKED_LINK` (also `OPEN_AN_EMAIL` / `CLICK_ON_A_LINK`) do not say what a reply does, so `stopOnReply` is `null` for them.
- Unconfirmed: the envelope (bare or `{ success, data }`); whether the legacy string form of `scheduler_cron_value` / `track_settings` still occurs (a JSON string is parsed); `sending_limit` appears only in the newer example and the settings guide ("Daily cap across all email accounts"); `out_of_office_detection_settings` is documented on `POST /campaigns/{id}/settings` only, so `stopOnAutoReply` is `null` unless a read returns it. There is no campaign end date.

### Subsequences: `GET /campaigns/` then `GET /campaigns/{child_id}/sequences`

- A subsequence is a child campaign: `parent_campaign_id` on a campaign row "references the parent campaign ID". The adapter filters the campaign list by it and reads each child's steps with the ordinary sequence endpoint.
- Unconfirmed: that `GET /campaigns/` returns child campaigns (implied by the field, stated nowhere). The trigger conditions (`conditionEvents`: `OPEN_AN_EMAIL`, `CLICK_ON_AN_EMAIL_LINK`, `REPLY_AN_EMAIL`, `REPLY_MESSAGE_BODY_TEXT`, `CATEGORY`) are write-only: no read returns them, so a step's `branch` is `null`.

### Sender health: `GET /email-accounts/{id}/` and `GET /email-accounts/{id}/warmup-stats`

- Mailbox fields: `is_smtp_success`, `is_imap_success`, `smtp_failure_error`, `imap_failure_error`, `from_email` (for the domain), `warmup_details.blocked_reason`, `warmup_details.warmup_reputation`.
- Warmup statistics cover the last 7 days. Older shape: `sent_count`, `spam_count`, `inbox_count`, `warmup_email_received_count` (strings). Newer shape: `total_sent`, `spam_count`, `reputation_score`. Both are read.
- Unconfirmed: which of the two warmup shapes is live. Not reported by this API: SPF, DKIM, DMARC, MX, block list checks, a check time. Those exist only in SmartDelivery (`smartdelivery.smartlead.ai`, another host and product, per spam test rather than per mailbox).

### Per-mailbox statistics: `GET /analytics/mailbox/name-wise-health-metrics`

- Params `start_date`, `end_date` (required), `timezone`; response `{ ok, data: { email_health_metrics: [ { email_account, sent, opened, replied, bounced } ] } }`. The mailbox is read first (`GET /email-accounts/{id}/`) for its address, and its row is picked by address.
- Unconfirmed: the list has `limit` / `offset` with no documented default or maximum and no filter for one mailbox, so a mailbox beyond the first page cannot be told from one with nothing sent; both give `null` counts. `opened` is not said to be unique. `GET /campaigns/{id}/mailbox-statistics` documents only the placeholder `{ "ok": true, "data": [] }` and is not used.

### Lead lists: `GET /lead-list/`

- Params `limit` (1 to 1000, default 10), `offset`, `listName`, `tagIds`. Response `{ ok, data: [ { id, name, lead_count, created_at } ] }`. No total: a full page means there may be more.
- Unconfirmed: the example looks hand-written.

### Block list: `GET /leads/get-domain-block-list`

- Params `offset`, `limit` (default 100, max 1000), `filter_client_id`, `filter_email_or_domain`, `filter_email_with_domain`. Response: a bare array of `{ id, email_or_domain, created_at, source, client_id }`. An entry with an `@` is an address, any other a domain.
- Unconfirmed: whether a client-level key sees only its own entries.

### Tags: `GET /email-accounts/tags`

- Bare array of `{ id, name, color }`: "all tags created by the user". The lead-tag page says tags "are created at the account level and can be used to organize both email accounts and leads".
- A lead's tags: `GET /crm/leads/tags?leadId=` returns `{ ok, data: [ { id, tag_mapping_id, name, color } ] }`. It is one request per lead, so only `leads.get` reads it.
- Unconfirmed: whether campaign tags (`tags[] { tag_id, tag_name, tag_color }` with `include_tags=true`) share this list. There is no tag description.

### Webhook subscriptions: `GET /campaigns/{campaign_id}/webhooks`

- Older shape (followed): bare array of `{ id, name, created_at, updated_at, webhook_url, email_campaign_id, event_types[], categories[] }`. Newer example: `{ success, data: [ { id, name, webhook_url, event_types, is_active } ] }` with event names that are not real ones. Both are read.
- There is no list of every webhook, so a listing without a campaign reads the campaign list and then one campaign per request.
- Unconfirmed: whether a user-level or client-level webhook is listed under a campaign (article 185: a user-level webhook "will be applied to all unmapped campaigns"); the adapter returns a webhook id once per walk in case it is listed under several.

### Messages by thread: `GET /master-inbox/{id}`

- `id` is the `campaign_lead_map_id`, which the activity feed calls `email_lead_map_id`; that is the `threadId` on messages and replies.
- Fields used: `message_history[]` (`direction` `outbound` / `inbound`, `sent_at` / `received_at`, `subject`, and `id`, `body` when present), `campaign.id`, `email_account.id`, `lead.id`.
- Unconfirmed: the whole item shape; the example is illustrative and shows history items without ids or bodies. The adapter also accepts the older history items (`type` `SENT` / `REPLY`, `stats_id`, `message_id`, `time`, `email_body`). An item without an id gets a hash of thread, direction, time and subject.

### Replies: every reply of a thread

- `POST /master-inbox/inbox-replies?fetch_message_history=true` adds `message_history` to each thread. Every inbound item is returned as a reply; without a history the thread gives its `last_message` as before.
- Unconfirmed: the history item shape (same as above), and whether `last_message.id` and the matching history `id` agree (the example shows different ids).

### Lead interest and tags

- `interest` is the lead category's name. `GET /campaigns/{id}/leads` gives `lead_category_id`; the name comes from `GET /leads/fetch-categories`, read once per walk. `GET /leads/{id}` shows `category_name` in its illustrative example only.

### Lead lookup by address: `GET /leads/?email=` (added 2026-11-14)

Read again on 2026-11-14 from https://api.smartlead.ai/llms-full.txt, page https://api.smartlead.ai/api-reference/leads/get-by-email.

- `leads.list({ email })` sends one `GET /leads/?email=<address>`. The response is the bare lead (`id`, `email`, names, `company_name`, `linkedin_profile`, `custom_fields`, `is_unsubscribed`, `created_at`) with `lead_campaign_data[]`: `campaign_lead_map_id`, `campaign_id`, `campaign_name`, `client_id`, `client_email`, `lead_category_id`. The adapter returns one record per item, with that campaign's ref. With a `campaignId` it keeps that campaign's item only.
- An unknown address is `{}` with HTTP 200 (also 401 and 422 `{"error": "email is required"}`); `{}` gives an empty page.
- `lead_campaign_data` has no lead status and no per-campaign creation time. The status is `unknown` (or `unsubscribed` from `is_unsubscribed`) and `createdAt` is the lead's own `created_at`. The status per campaign is only in `GET /leads/{leadId}/campaign-overview`, which refuses client-level keys, so it is not read.
- `interest` needs the category names: one more request (`GET /leads/fetch-categories`) when a returned item has a `lead_category_id`. A lookup is therefore 1 or 2 requests.
- Fallback, not documented as needed: if the lead comes without `lead_campaign_data`, the campaigns are read from the legacy `GET /leads/{lead_id}/campaigns` (`{ id, status, name }`, where `status` is the campaign's, not the lead's).
- Unconfirmed: whether the address match is exact or case-sensitive (the adapter sends the lowercased address and drops a lead whose `email` differs), whether the response is ever wrapped in `{ ok, data }` (accepted), and whether inactive campaign memberships are listed.
- No endpoint looks a lead up by LinkedIn profile: `linkedin_profile` is only a field on lead payloads. `leads.list({ linkedinUrl })` returns an empty page without a request.
- Every record of one person carries the same lead id, so the refs are equal: `list` returns one record per campaign and `listAll`, which keeps each ref once, returns one.

### Not available from the API

- **`leads.engagement`** (per-lead open, click and reply counts): the endpoint for it, `GET /campaigns/{id}/leads-statistics`, documents only the placeholder `{ "ok": true, "data": [] }` in every source, so nothing can be mapped without guessing. `GET /campaigns/{id}/leads-export` has `open_count`, `click_count`, `reply_count` but returns CSV. `POST /campaigns/{id}/leads/filter` (`fieldSet: "active_table"`) has `last_sent_time`, `latest_reply_time` and `current_seq_num`, but no counts, no creation time, a different order from the lead list, and it refuses client keys.
- **`lists.leads`**: no endpoint returns the leads of a lead list (only import, push to a campaign and push between lists).
- **`campaigns.status` server-side**: `GET /campaigns/` has no status parameter ("Use the campaign status filter in your application logic after fetching").
- **`leads.since` server-side**: `created_at_gt` is "leads created after", exclusive, with no upper bound, and it is not said whether it compares the lead's creation or the time it joined the campaign (the row's `created_at`, which the SDK reports). Left to the wrapper.
- **`messages.since` / `replies.since` server-side**: `event_time_from` narrows the feed to leads with activity and `replyTimeBetween` narrows the inbox to threads; both are sent, and the wrapper still filters each message on its own time.
- **`senderRef` on messages** from the activity feed and a lead's history: they name the mailbox by address (`from_email`, `from`) only.
- **`leadRef` on replies**, unless the thread carries `lead.id` or `lead_id`: every documented example names the lead by address.
- **Sender DNS records, block list state and check time**, **a campaign end date**, **a tag description**, **subsequence trigger conditions on read**, **a list of every webhook**, **daily rows per mailbox or per step**.

## Endpoint inventory and native catalog (added 2026-11-14)

Fetched fresh on 2026-11-14: `https://api.smartlead.ai/llms-full.txt` (262 pages, 242 of them endpoint pages) and `https://api.smartlead.ai/llms.txt`. No API call was made. The result is `site/content/docs/coverage/smartlead.mdx` (230 endpoints) and the native catalog in `src/smartlead/native*.ts` (78 reads).

- **Sister services.** All four take the same `api_key` query parameter under `/api/v1` on their own host. The SmartDelivery pages document no parameter beyond the path ids, and say "Contact support for access and API details", so those entries declare none. SmartProspect takes its paging numbers as strings.
- **Secrets, left out of the catalog.** `GET /client/api-key` (client keys), `GET /email-accounts/fetch-email-account-details` (same payload as the mailbox by id, passwords included), `GET /smart-senders/order-details` (a `password` per mailbox), `GET /smart-senders/auth-secret` (a one-time password). `GET /client/{id}` is catalogued without `includeWhitelabel`, which adds `gpt_api_info` and whitelabel credentials, and `GET /campaigns/{id}/mailbox-statistics` without `private_api_key`.
- **POSTs that are not reads.** `POST /search-email-leads/search-contacts` answers with a `filter_id`, so it records the search; `fetch-contacts` and `search-contacts/find-emails` spend credits (`402 Payment Required` is documented). All three are listed as writes.
- **Rate lanes.** `GET /campaigns/{id}/leads-statistics` and `GET /analytics/mailbox/domain-wise-health-metrics` are native reads on their own 10 per 60 seconds lanes; the third laned endpoint, the activity feed, is the normalized `messages.list`.
- **Considered for normalizing, and left native.**
  - `GET /analytics/day-wise-overall-stats-by-sent-time` has a daily `bounced`, which `stats.byDay` leaves `null`. It counts every metric on the day the email was sent, while the normalized daily rows count each on the day it happened, so mixing the two would put a different meaning in one row.
  - `GET /campaigns/{id}/leads-export` has `open_count`, `click_count` and `reply_count` per lead, which would fill `leads.engagement`. It is one CSV of the whole campaign with no paging and no documented quoting rules.
  - `GET /campaigns/{id}/leads-statistics` and `/mailbox-statistics` still document only a placeholder response.
- **Paths without a reference page.** `llms.txt` and the quickstart name `GET /webhooks`, `GET /leads/by-email`, `GET /analytics/overview`, `PATCH /campaigns/{id}/status` and `POST /campaigns/new`; the reference pages give different paths for each, and these are not inventoried.

## Sources

Fetched 2026-11-14.

- https://api.smartlead.ai/llms.txt
- https://api.smartlead.ai/llms-full.txt (all 262 pages; the ones relied on are listed by path below)
- https://api.smartlead.ai/sitemap.xml
- https://api.smartlead.ai/reference (redirects to /api-reference/campaigns/get-all)
- https://api.smartlead.ai/api-reference/openapi.json (Mintlify sample spec, not Smartlead's)
- https://api.smartlead.ai/introduction, /authentication, /faq, /core/campaigns, /core/leads, /core/email-accounts, /core/sequences, /core/webhooks, /guides/rate-limits, /guides/error-handling, /guides/webhook-integration
- https://api.smartlead.ai/api-reference/campaigns/ get-all, get-by-id, get-sequences, get-email-accounts, get-leads, get-lead-by-id, get-lead-history, get-leads-history-bulk, all-leads-activities, search-leads, statistics, get-analytics, get-analytics-by-date, get-top-level-analytics, get-webhooks, save-webhooks, get-webhook-summary, assign-client, update-status
- https://api.smartlead.ai/api-reference/campaign-statistics/ get-by-id, get-by-date-range, top-level, top-level-by-date, lead-statistics, mailbox-statistics, sequence-analytics
- https://api.smartlead.ai/api-reference/email-accounts/ get-all, get-by-id, warmup-stats
- https://api.smartlead.ai/api-reference/leads/ get-by-campaign, get-by-email, categories, create-category, campaign-overview, sequence-details, activities, export
- https://api.smartlead.ai/api-reference/lead-lists/get-all
- https://api.smartlead.ai/api-reference/inbox/ get-messages, get-sent, get-unread, get-by-id, get-untracked, reply-status, mark-read
- https://api.smartlead.ai/api-reference/clients/ get-all, get-by-id, api-keys, create
- https://api.smartlead.ai/api-reference/webhooks/ events, create, get, update, delete
- https://api.smartlead.ai/api-reference/analytics/ overview, day-wise-stats, day-wise-sent-time, day-wise-positive-reply, campaign-performance, client-performance, email-wise-health, domain-wise-health, lead-category-response, campaign-list, client-list, campaign-status-stats, how-metrics-are-calculated
- https://api.smartlead.ai/guides/webhook-signing (404; linked from the help center)
- https://api.smartlead.ai/changelog (404)
- https://helpcenter.smartlead.ai/llms.txt
- https://helpcenter.smartlead.ai/en/articles/68-how-to-get-started-with-the-smartlead-api.md
- https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation.md
- https://helpcenter.smartlead.ai/en/articles/430-how-client-level-api-keys-work-in-smartlead.md
- https://helpcenter.smartlead.ai/en/articles/449-how-multiple-admin-api-keys-work-in-smartlead.md
- https://helpcenter.smartlead.ai/en/articles/470-secure-your-smartlead-webhooks-with-signing-hmac.md
- https://helpcenter.smartlead.ai/en/articles/481-secure-your-smartlead-webhooks-with-jwt.md
- https://helpcenter.smartlead.ai/en/articles/35-set-up-smartlead-webhooks-for-campaign-automation.md
- https://helpcenter.smartlead.ai/en/articles/185-assigning-webhooks-to-campaigns-clients-or-users.md
- https://helpcenter.smartlead.ai/en/articles/229-webhook-not-sending-triggers.md
- https://helpcenter.smartlead.ai/en/articles/402-how-to-retry-or-resend-webhooks.md
- https://helpcenter.smartlead.ai/en/articles/403-quick-tips-for-testing-with-sample-webhook-payloads.md
- https://helpcenter.smartlead.ai/en/articles/122-how-to-replicate-the-ui-campaign-analytics-using-the-api.md
- https://helpcenter.smartlead.ai/en/articles/439-smartlead-pricing-plans.md
- Downloaded but not relied on: articles 86, 184, 210, 417
- Read again on 2026-11-14 for the parity work: https://api.smartlead.ai/llms-full.txt (pages api-reference/campaigns/ get-by-id, get-all, create-subsequence, update-settings, update-schedule, get-webhooks, search-leads, get-lead-by-id, get-lead-history, all-leads-activities; api-reference/campaign-statistics/ mailbox-statistics, lead-statistics; api-reference/email-accounts/ get-by-id, warmup-stats, tags; api-reference/email-account-tags/ get-all, create-new; api-reference/lead-tags/ get-all, create, add-to-lead; api-reference/lead-lists/ get-all, get-by-id; api-reference/analytics/ email-wise-health, domain-wise-health, mailbox-health; api-reference/inbox/ get-messages, get-by-id; api-reference/leads/ get-by-campaign, get-by-email, campaign-overview, categories; api-reference/utilities/domain-block-list), https://helpcenter.smartlead.ai/llms.txt, and help-center articles 122, 184 and 185
- https://help.smartlead.ai/API-Documentation-a0d223bdd3154a77b3735497aad9419f (Notion, titled "API Documentation [DEPRECATED]")
- https://help.smartlead.ai/smartleadai/Webhook-Guide-Updated-4d0ae6b2fa6a4db1b4c1ead824a86866 and its child pages: Email-Sent, Email-Opened, Link-Clicked, Email-Replied, Threaded-Replies, Email-Bounce, Lead-Unsubscribed, Lead-Category-Updated, Campaign-Status-Change, Untracked-replies, Manual-Step-Reached

This rewrite (after the first copy was lost) was produced from the earlier fetches without re-fetching any page.

## Read again on 2026-11-14 for field coverage and the derived reads

Source: `https://api.smartlead.ai/llms-full.txt`, fetched fresh. Nothing here was run against a live account.

- **Out-of-office replies.** The `analytics-by-date` page (api-reference/campaigns/get-analytics-by-date) has a section "Separating out-of-office replies": `total_reply_count` is "Every reply, with no exclusions", `non_ooo_reply_count` is "Replies from leads not categorised as out-of-office", and it gives the formula `ooo_replies = total_reply_count - non_ooo_reply_count`. `repliedAuto` on a dated total is that difference. `reply_count` is not used for it: it leaves out replies flagged as ignored.
- **Positive replies per day.** `GET /analytics/day-wise-positive-reply-stats` (api-reference/analytics/day-wise-positive-reply): `{ ok, data: { day_wise_stats: [{ date, positive_replied }] } }`, with the same `start_date`, `end_date`, `timezone`, `campaign_ids` as the day-wise counts. The adapter reads it beside `day-wise-overall-stats`.
- **Every campaign's stats (`stats.allCampaigns`).** `GET /analytics/campaign/overall-stats` (api-reference/analytics/campaign-performance): `{ ok, data: { campaign_wise_performance: [{ id, campaign_name, sent, opened, replied, bounced, positive_replied, unique_lead_count, unique_open_count, ...rates }] } }`. `start_date` and `end_date` are required. `limit`, `offset` and `full_data` ("Set to \"true\" to return full data set") are optional and their defaults are not stated; the adapter sends `full_data=true`. Whether that returns every campaign of a large account is not confirmed.
- **Step clicks.** `sequence-analytics` has one `click_count` and one `open_count` per step and variant and calls neither unique. Both are read as totals (`clickedTotal`, `openedTotal`).
- **A sender's campaigns (`campaigns.bySender`).** `GET /email-accounts/{id}/?fetch_campaigns=true` (api-reference/email-accounts/get-by-id): "Array of campaign IDs using this email account (only if `fetch_campaigns=true`)". The campaign list is then narrowed to those ids.
- **Sender fields.** `type` is `GMAIL`, `OUTLOOK` or `SMTP`. `tags[] { tag_id, tag_name, tag_color }` is "Always included in the response" of the mailbox list.
- **Unread.** A master-inbox thread carries `is_read`. `POST /master-inbox/unread-replies` exists and stays native: its response is assumed, not documented, to match `inbox-replies`. The filter is applied after fetching.
- **Per-lead engagement, still not mapped.** The current `all-leads-activities` page shows a flat list of events (`lead_email`, `activity_type`, `event_time`), which contradicts the rows with `activities[]` the adapter follows from the older source. The campaign statistics page gives one example of account totals and a field list of per-email rows. No source agrees with another, so per-lead counts stay `null` until a live account settles the shape.
- **One list, one webhook (`lists.get`, `webhooks.get`).** `GET /lead-list/{id}` (api-reference/lead-lists/get-by-id): `{ ok, data: { id, name, lead_count, created_at, updated_at } }`. `GET /webhook/{webhook_id}`: `{ ok, data: { id, email_campaign_id, name, webhook_url, event_type_map, category_id_map, created_at, updated_at } }`. It names events as the keys of `event_type_map` whose value is true, where the per-campaign list uses an `event_types` array; the mapper reads either.
- **Campaign progress (`campaigns.progress`).** `GET /campaigns/{id}/analytics` carries `campaign_lead_stats { total, notStarted, inprogress, completed, stopped, blocked }` in the documented example.
- **Placement tests (`placementTests.list`).** SmartDelivery, `POST https://smartdelivery.smartlead.ai/api/v1/spam-test/report` with an empty body: a bare array of `{ spam_test_id, test_name, test_type (automated | manual), status (active | completed), schedule_start_time, test_end_date, every_days, current_test_run_no }`. The page says to contact support for access. No paging is documented. Results (`/spam-test/report/{id}/providerwise`, `/sender-account-wise`) are rates and stay native.

## Response shapes for list endpoints (2026-11-15, for OUT-73)

Fetched fresh on 2026-11-15 to decide which 200 bodies a list read may accept:

- https://api.smartlead.ai/llms.txt (now a short index; it no longer lists every page)
- https://api.smartlead.ai/llms-full.txt (262 pages, the same count as on 2026-11-14), read by page: `api-reference/campaigns/` get-all, get-email-accounts, get-leads, get-webhooks, all-leads-activities, get-lead-history; `api-reference/leads/` get-by-campaign, categories, activities, get-by-email; `api-reference/email-accounts/` get-all, tags; `api-reference/email-account-tags/get-all`; `api-reference/lead-lists/get-all`; `api-reference/utilities/domain-block-list`; `api-reference/clients/get-all`; `api-reference/lead-tags/get-all`; `api-reference/inbox/get-messages`; `api-reference/smart-delivery/list-tests`
- https://api.smartlead.ai/sitemap.xml (262 URLs)

There is still no OpenAPI spec, so "documented" below means the page's own 200 example. `unwrap` means the adapter's existing rule: a body `{ ok | success, data }` is read as its `data`.

| Endpoint | Read by | Documented 200 body | List field | Paging |
| --- | --- | --- | --- | --- |
| `GET /campaigns/` | `campaigns.list`, the campaign walk behind `leads.list`, `webhooks.list`, `sequence.subsequences` | bare array ("Response (Actual from API - Direct Array)", and a note: "returns a direct array of campaigns, not wrapped") | the body | none |
| `GET /campaigns/{id}/email-accounts` | `senders.list({ campaignId })` | `{ ok, data: [...] }` on the current page; bare array in the legacy docs | `data`, or the body | none |
| `GET /email-accounts/` | `senders.list` | bare array | the body | `offset`, `limit` (max 100); no total, no marker |
| `GET /campaigns/{id}/leads` | `leads.list`, `campaign.leads` | `{ total_leads, offset, limit, data: [...] }` (`leads/get-by-campaign`) | `data` | `offset`, `limit` (max 100); `total_leads` a string |
| same URL, page `campaigns/get-leads` | (not followed) | `{ total, leads: [...] }` with flat lead rows | `leads` | `total` |
| `GET /leads/fetch-categories` | category names (lookup) | bare array | the body | none |
| `GET /campaigns/all-leads-activities` | `messages.list` | `{ data: [...], hasMore }` (`leads/activities`); `{ total, data: [...] }` with flat event rows (`campaigns/all-leads-activities`) | `data` in both | `offset`, `limit`; `hasMore` |
| `POST /master-inbox/inbox-replies` | `replies.list` | `{ messages: [...], total_count, offset, limit }` | `messages` | `offset`, `limit` (max 20) in the body; `total_count` |
| `GET /lead-list/` | `lists.list` | `{ ok, data: [...] }` | `data` | `offset`, `limit` (1 to 1000) |
| `GET /leads/get-domain-block-list` | `blocklist` | bare array | the body | `offset`, `limit` (max 1000) |
| `GET /email-accounts/tags` | `tags.list` | bare array | the body | none |
| `GET /crm/leads/tags?leadId=` | `leads.get` (the lead's tags) | `{ ok, data: [...] }` (`lead-tags/get-all`) | `data` | none |
| `GET /client/` | `workspaces.list` | `{ ok, data: [...] }` on the current page; bare array in the legacy docs | `data`, or the body | none |
| `GET /campaigns/{id}/webhooks` | `webhooks.list` | `{ success, data: [...] }` on the current page; bare array in the legacy docs | `data`, or the body | none |
| `POST smartdelivery.smartlead.ai/api/v1/spam-test/report` | `placementTests.list` | bare array (`smart-delivery/list-tests`) | the body | none |
| `GET /leads/{id}/campaigns` | `messages.list({ leadId })`, `leads.lookup` | not in the current reference; legacy docs only, bare array | the body | none |
| `GET /leads/?email=` | `leads.lookup`, `leads.exists` | one lead object; `{}` with 200 when not found (unchanged) | not a list | none |

Ambiguous or not documented:

- **`GET /campaigns/` contradicts itself.** The field list on the same page says the response is `success` (boolean) and `campaigns` (array), and its Python, JavaScript and PHP samples read `data['campaigns']`. The example labelled "Actual from API" and the note under it say a bare array. The bare array is followed; `{ campaigns: [...] }` is accepted too because the page names it.
- **Bare or wrapped.** `campaigns/{id}/email-accounts`, `/client/` and `campaigns/{id}/webhooks` show a wrapped example on the current page and a bare array in the legacy docs. Both stay accepted.
- **Two pages for one URL.** `GET /campaigns/{id}/leads` (`{ total, leads }` on `campaigns/get-leads`) and `GET /campaigns/all-leads-activities` (`{ total, data }` with flat rows on `campaigns/all-leads-activities`). Both alternates look hand-written. The leads alternate has no `data`, so under a strict rule it fails instead of reading as empty.
- **`GET /leads/{id}/campaigns` is not in the current reference.** Only the deprecated Notion docs show it.
- No page documents what an empty list looks like. A documented empty list is read as `[]`, `{ ok: true, data: [] }`, or an object whose list field is `[]`.
- `fixtures/smartlead/` matches these shapes, with both forms kept where the docs disagree (`*.newdocs.json`).

## Tracking settings behind open and click counts (2026-11-16, for OUT-89)

Fetched 2026-11-16: `https://api.smartlead.ai/llms-full.txt`, pages `api-reference/campaigns/get-all` ("Get All Campaigns", example `"track_settings": ["DONT_EMAIL_OPEN", "DONT_LINK_CLICK"]`) and `api-reference/campaigns/get-by-id` (example `"track_settings": ["DONT_EMAIL_OPEN"]`). Both reads carry `track_settings`, the list of what is not tracked, as recorded above. Only the current setting is given.

`GET /analytics/campaign/overall-stats` (api-reference/analytics/campaign-performance) has `sent`, `opened` and `unique_open_count` per campaign but no click count, so at workspace and mailbox scope a campaign with link tracking off counts as not measuring clicks. The workspace and daily rows have no click count anyway.

## BLOCKED: bounced or block-listed (2026-11-16, for OUT-106)

Question: can a lead's fields tell a block-listed BLOCKED lead that was never sent to (which would be `skipped`, `bounced: false`) apart from a real bounce? **Not from the documentation.** The mapping stays as it was: BLOCKED sets `bounced: true` and leaves progress `unknown`. All of this is from the docs. There is no Smartlead key (OUT-10), so nothing was checked live.

Sources, fetched 2026-11-16: https://api.smartlead.ai/llms-full.txt (262 pages). The pages relied on:

- https://api.smartlead.ai/core/leads. Its lead status table gives `BLOCKED` as "In block list". The older docs (see Lead status values above) say "bounced or on the block list".
- https://api.smartlead.ai/api-reference/leads/get-by-campaign. The `status` filter lists `STARTED`, `INPROGRESS`, `COMPLETED`, `PAUSED`, `STOPPED` (no `BLOCKED`). The row example has no `email_stats`, no `last_sent_time` and no sent count.
- https://api.smartlead.ai/api-reference/campaigns/get-leads, the duplicate page for the same URL. Only this page shows `last_sent_time` and `email_stats { is_opened, is_clicked, is_replied, is_bounced }` on a listed lead. Its envelope (`{ leads, offset, limit }`) conflicts with the other page and the legacy docs, and it was already treated as wrong (see List per campaign above).
- https://api.smartlead.ai/api-reference/campaigns/get-lead-by-id. `email_stats` has only `is_opened`, `is_clicked` and `is_replied`.
- https://api.smartlead.ai/api-reference/utilities/domain-block-list. Block-list entries carry a `source` of manual, bounce or spam, so a bounce itself puts an address on the block list. "Block-listed" therefore does not mean "never sent to".
- https://api.smartlead.ai/guides/lead-management. "Blocked leads are automatically skipped during import", which is about leads that are never added to the campaign, not about a campaign lead with status BLOCKED.
- https://api.smartlead.ai/api-reference/campaign-statistics/sequence-analytics. `total_stats` and each variant's `stats` carry `skipped_count`. No page defines what it counts. It is a per-step email count, not a count of leads, so it would not fit `CampaignProgress.skipped`. It stays unread.

Why the split is not provable:

1. The only lead shape with `is_bounced` or `last_sent_time` is the conflicting duplicate page.
2. No page says what `is_bounced` or `last_sent_time` hold on a BLOCKED lead.
3. Block-list entries can themselves come from bounces.

A possible later route, which needs a live key: list a campaign's leads with `emailStatus=is_bounced` and treat a BLOCKED lead missing from that list as block-listed only. The filter's behaviour on BLOCKED leads is not documented.

`CampaignProgress.skipped` is `null` on Smartlead (declared unfilled). `campaign_lead_stats.blocked` counts block-listed and bounced leads together.

## A step delay below zero (2026-11-16, for OUT-110)

Fetched 2026-11-16: https://api.smartlead.ai/api-reference/campaigns/get-sequences.md. `seq_delay_details.delayInDays` is a `number`, "Number of days to wait before sending this sequence", with no stated minimum. A negative value has not been seen from Smartlead; Instantly sent one on a live campaign (OUT-110). The normalized `delayDays` must be 0 or more, so the adapter maps a negative delay to `null` with a note in `meta.notes`, for example "Step 2's delay is negative in Smartlead (-3 days); left out.", instead of failing the whole sequence read.

## Meeting status and thread context (2026-11-17, for OUT-139)

Fetched 2026-11-17: https://api.smartlead.ai/llms-full.txt, https://api.smartlead.ai/api-reference/leads/categories, https://api.smartlead.ai/api-reference/inbox/update-category, https://api.smartlead.ai/api-reference/campaigns/get-lead-history, https://api.smartlead.ai/api-reference/campaigns/get-leads-history-bulk.

- No meeting field, status or time exists on a lead or a message. The only signal is the lead category, which a workspace names. The `fetch-categories` example shows id 3 "Meeting Booked" (positive), while `update-category` lists id 2 "Meeting Request" and id 3 "Not Interested", so the global list is not settled. A category's wording is not read as a meeting, so `fields.lead.meeting` is `false` and `meeting` is always `null`; the category stays in `interest` and `vendorSentiment`.
- A lead's history (`GET /campaigns/{c}/leads/{l}/message-history`) gives each message a `direction` (outbound or inbound) and `sent_at` or `received_at`; no preview field. Every example is illustrative.
- `POST /campaigns/{c}/message-history-for-leads/...` takes `lead_ids[]` for one campaign. Not used yet: its row shape is unverified, so `thread_context` reads one timeline per lead.

## Conversation links (OUT-140, 2026-11-17)

Sources, read 2026-11-17: `https://api.smartlead.ai/api-reference/inbox/get-by-id.md` (calls the item read "essential for deep linking" but gives no app URL), `https://api.smartlead.ai/api-reference/inbox/get-messages.md`, and the webhook pages `https://help.smartlead.ai/Email-Replied-aeebacc09db9456fbf23dcf5c6cbd0fd` and `https://help.smartlead.ai/Lead-Category-Updated-22cab06ce4a0499ca417916cececa62c`. `app_url` (and the deprecated `ui_master_inbox_link`) is documented only as the master inbox page, `https://app.smartlead.ai/app/master-inbox`, or `https://app.smartlead.ai/app`, never with a conversation in it. No Smartlead key was available to check live. A message's and reply's `url` is null and the field coverage says `false`.
