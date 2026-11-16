# EmailBison API research

> This is the research record the EmailBison adapter was written from. The fixtures used by the tests are in `fixtures/emailbison/`; `fixtures/emailbison/SYNTHESIZED.md` lists the ones built from the reference rather than copied from it.

Fetched 2026-11-15 from public documentation only. No API calls were made against an account and no credentials were used. No EmailBison workspace or key exists for this project, so **nothing here has been checked against a live account**, and the adapter's maturity is `unverified`.

## Sources read

| URL | What it is | Read |
| --- | --- | --- |
| `https://dedi.emailbison.com/api/reference` | The API reference (Scalar), the page the docs link to as "Full API Reference". | 2026-11-15 |
| `https://dedi.emailbison.com/api/reference.openapi` | The OpenAPI 3.0.3 document behind it (YAML, 791 KB, 180 operations). The inventory and every request and response shape below come from this file. | 2026-11-15 |
| `https://docs.emailbison.com/llms.txt` | Index of the guide pages (Mintlify). Its "OpenAPI Specs" link, `https://docs.emailbison.com/api-reference/openapi.json`, answers 404. | 2026-11-15 |
| `https://docs.emailbison.com/get-started/introduction.md` | Introduction. | 2026-11-15 |
| `https://docs.emailbison.com/get-started/quickstart/notes-and-terminology.md` | Base URL, path, query and body parameters, array syntax. | 2026-11-15 |
| `https://docs.emailbison.com/get-started/quickstart/making-http-requests.md` | Making requests. | 2026-11-15 |
| `https://docs.emailbison.com/get-started/authentication.md` | Bearer keys, `api-user` and `super-admin` keys. | 2026-11-15 |
| `https://docs.emailbison.com/get-started/pagination.md` | 15 per page, page and cursor pagination, the 1,000-page cap. | 2026-11-15 |
| `https://docs.emailbison.com/workspaces/overview.md` | Keys are scoped to one workspace. | 2026-11-15 |
| `https://docs.emailbison.com/webhooks/overview.md` | Webhooks and test events. | 2026-11-15 |
| `https://docs.emailbison.com/webhooks/when-are-webhooks-triggered.md` | The webhook events and when each fires. | 2026-11-15 |
| `https://docs.emailbison.com/webhooks/events-deliveries-and-attempts.md` | Events, deliveries, attempts, 10-day event history, 15 s timeout. | 2026-11-15 |
| `https://docs.emailbison.com/master-inbox/overview.md`, `.../master-inbox/fetching-replies.md` | The master inbox, a lead's replies and sent emails. | 2026-11-15 |
| `https://docs.emailbison.com/leads/overview.md`, `.../campaigns/overview.md`, `.../email-accounts/overview.md`, `.../tags/overview.md` | Concepts: leads, campaigns, sender emails, default tags. | 2026-11-15 |
| `https://docs.emailbison.com/walkthroughs/send-slack-message-on-reply.md` | Webhook walkthrough. No payload is shown. | 2026-11-15 |
| `https://emailbison.com/developers` | Marketing developer page: a sample `tag.attached` webhook, retries, and the 429, 401 and 422 error bodies. | 2026-11-15 |
| `https://emailbison.com/blogs/emailbison-vs-salesloft` | Marketing blog post that states "3,000 requests/minute". The only number for a rate limit anywhere. | 2026-11-15 |

There is no changelog for the API. The only changelog in `llms.txt` is for the bulk uploader tool, which is not part of the API.

## Read this first: how reliable the reference is

- The OpenAPI document is generated (Laravel Scribe). Paths, methods and parameter names look reliable.
- **Response examples are hand-written strings, and many are not valid JSON**: unquoted values (`"sequence_prioritization": new_leads`), missing commas, trailing commas, an unclosed string (`"jane@doe.com,`), and `GET /api/workspaces/v1.1`, whose example is an object holding bare arrays of key-value pairs. Every fixture copied from an example was repaired to valid JSON, keeping the documented keys and values; `SYNTHESIZED.md` says what was changed.
- Several examples carry placeholder hosts (`http://bison.test`, `http://localhost`) in their `links`.
- Response schemas are declared for some endpoints and absent for others; the example is then the only description.
- Some list reads are documented with body parameters on a `GET`. The terminology page says "EmailBison will convert body parameters into query parameters automatically, if the parameter names match", so the adapter sends them in the query.

## Basics

- **Base URL:** the URL the customer logs in with. "If you log in to `https://send.greenmarketing.com`, then the preceding request should be made to `https://send.greenmarketing.com/api/tags/attach-to-leads`" (notes-and-terminology). The reference's only server is `https://dedi.emailbison.com`, which the adapter uses when no base URL is given. The adapter reads `EMAILBISON_BASE_URL`.
- **Paths:** every endpoint is under `/api/`.
- **Auth:** `Authorization: Bearer <key>`. Two key types: `api-user` (one workspace) and `super-admin` (impersonates the user; scoped to whichever workspace the user is in). "API requests to EmailBison are always scoped to one workspace, for both key types." Keys look like `9|q8kSmhjJRqJVT2kc1M0ezX640Pxk`.
- **Ids:** integers. A lead can be named by id or by email on `GET /api/leads/{lead_id}` ("The ID or email of the lead", master-inbox page; the reference says the same for `sent-emails` and `replies`).
- **Timestamps:** ISO 8601 with microseconds and `Z`, for example `2025-04-14T16:59:21.000000Z`.
- **Arrays in the query:** `tag_ids[]=1&tag_ids[]=2`.
- **Envelope:** every response is `{ "data": ... }`. A list is `{ data: [...], links, meta }`.

## Pagination

- 15 records per page; no page-size parameter is documented anywhere.
- Page pagination: `?page=N`, with `meta.current_page` and `meta.last_page`, and `links.next`. "Traditional page based pagination is automatically limited to 1000 pages for all index routes", which is 15,000 records.
- Cursor pagination: `?pagination_type=cursor`, then `?cursor=<meta.next_cursor>`. `meta.next_cursor` is `null` on the last page. The reference says which routes support it: campaigns, a campaign's leads, replies and sender emails, a campaign's scheduled emails, every lead, a lead's replies, replies, sender emails, blacklisted emails, scheduled emails, and events (cursor only).
- The adapter asks for cursor pagination where it is documented and reads page numbers elsewhere. Its page reader accepts either answer: a `next_cursor` continues by cursor, otherwise `current_page` below `last_page` continues by page.

## Rate limits

- **Not documented in the reference.** The only limit the reference states is on the OAuth session writes: "this endpoint has a limit of 60 requests per minute."
- The developer page says "Standard limits apply per key. Handle 429 and retry after the window indicated by headers", with a 429 body `{ "error": "rate_limited", "retry_after": 8 }`. It names no header.
- A marketing blog post says "API throughput reaches up to 3,000 requests per minute". Dedicated instances are run per customer, so the number may differ by instance.
- The adapter declares 3,000 per minute from that post and uses half of it by default, like every adapter. This is a guess and is listed in the caveats.

## Errors

From the developer page: `429 { "error": "rate_limited", "retry_after": 8 }`, `401 { "error": "invalid_token" }`, `422 { "error": "validation_error", "fields": {...} }`. The reference's error examples are `{ "data": { "success": false, "message": "..." } }`. The adapter uses the shared error mapper, which reads either.

## Endpoint inventory

180 operations: 64 `GET`, one `POST` that only reads (`POST /api/campaigns/{campaign_id}/stats`), and 115 writes. Every one is in `site/content/docs/coverage/emailbison.mdx`. Notable reads:

### Campaigns

- `GET /api/campaigns`: `search`, `status`, `tag_ids`, `pagination_type`. `status` is one of `draft`, `launching`, `active`, `stopped`, `completed`, `paused`, `failed`, `queued`, `archived`, `pending deletion`, `deleted`. Records show it capitalised (`Active`, `Launching`). Each campaign carries lifetime counts (`emails_sent`, `opened`, `unique_opens`, `replied`, `unique_replies`, `bounced`, `unsubscribed`, `interested`, `total_leads_contacted`, `total_leads`), settings (`max_emails_per_day`, `max_new_leads_per_day`, `plain_text`, `open_tracking`, `can_unsubscribe`), `created_at` and `tags[]` (`id`, `name`, `default`).
- `GET /api/campaigns/{id}`: the same record.
- `GET /api/campaigns/{campaign_id}/schedule`: one window: a boolean per weekday, `start_time`, `end_time` (`HH:MM`), `timezone` (IANA).
- `GET /api/campaigns/v1.1/{campaign_id}/sequence-steps`: `{ data: { sequence_id, sequence_steps: [...] } }`. Each step: `id`, `email_subject`, `email_body`, `order`, `wait_in_days` (strings in the example), `variant`, `variant_from_step_id`, `thread_reply`, `active`. A variant is a step with `variant: true`; `variant_from_step_id` names the step it varies, and is `null` in the documented example for the one variant shown. The deprecated `GET /api/campaigns/{campaign_id}/sequence-steps` is the same read.
- `POST /api/campaigns/{campaign_id}/stats`: totals between `start_date` and `end_date` (both required), counts as strings, and `sequence_step_stats[]` with a row per step (`sequence_step_id`, `sent`, `leads_contacted`, `unique_opens`, `unique_replies`, `unsubscribed`, `bounced`, `interested`). A `POST` that only reads.
- `GET /api/campaigns/{campaign_id}/line-area-chart-stats`: daily series between two required dates, as `[{ label, color, dates: [[day, count], ...] }]` with labels `Replied`, `Total Opens`, `Unique Opens`, `Sent`, `Bounced`, `Unsubscribed`, `Interested`.
- `GET /api/campaigns/{campaign_id}/leads`, `.../sender-emails`, `.../replies`, `.../scheduled-emails`: a campaign's leads (with `lead_campaign_data`), senders, replies and scheduled emails.

### Leads

- `GET /api/leads`: `search` and `filters.*` (campaign status, counts, verification status, tags, `created_at` and `updated_at` by day with a comparison). A lead: `first_name`, `last_name`, `email`, `title`, `company`, `notes`, `status` (verification: `verifying`, `verified`, `risky`, `unknown`, `unverified`, `inactive`, `bounced`, `unsubscribed`), `custom_variables[]` (`name`, `value`), `overall_stats` (`emails_sent`, `opens`, `unique_opens`, `replies`, `unique_replies`), `created_at`. No phone, LinkedIn or website field: those live in custom variables.
- `GET /api/campaigns/{campaign_id}/leads`: the same record with `lead_campaign_data` (`status`, `status_reason`, `emails_sent`, `opens`, `replies`, `interested`). The only documented `status` value is `stopped` (`status_reason: stopped_manually`); the filter on the same read takes `in_sequence`, `sequence_finished`, `sequence_stopped`, `never_contacted`, `replied`.
- `GET /api/leads/{lead_id}`: one lead, by id or email.
- `GET /api/leads/{lead_id}/sent-emails`: the lead's sent campaign emails, unpaginated in the example, each with `campaign_id`, `sender_email_id`, `sequence_step_id`, `email_subject`, `email_body`, `status`, `sent_at`, `opens`, `clicks`, `replies`.
- `GET /api/leads/{lead_id}/replies`: the lead's replies, with the reply filters.

### Messages

- `GET /api/scheduled-emails`: campaign emails across the workspace, filtered by `status` (`sent`, `scheduled`, `failed`, `paused`, `stopped`, `bounced`, `unsubscribed`), `campaign_ids`, `lead_ids`, `sender_email_ids` and `scheduled_date_local` by day. Each has `campaign_id`, `sequence_step_id`, `sent_at`, `raw_message_id`, and nested `campaign`, `lead` and `sender_email`. There is no read of every sent email other than this one.
- `GET /api/replies/{reply_id}/conversation-thread`: `{ current_reply, older_messages, newer_messages }`, each a reply record. Outgoing messages in a thread have `folder: "Sent"`.

### Replies

- `GET /api/replies`: the master inbox. Filters `search`, `status` (`interested`, `automated_reply`, `not_automated_reply`), `folder` (`inbox`, `sent`, `spam`, `bounced`, `all`), `read`, `campaign_id`, `sender_email_id`, `lead_id`, `tag_ids`. A reply: `folder`, `subject`, `read`, `interested`, `automated_reply`, `html_body`, `text_body`, `date_received`, `type` (`Untracked Reply` in every example; `Outgoing Email` on a sent message in the events example), `tracked_reply`, `scheduled_email_id`, `campaign_id`, `lead_id`, nested `lead`, `sender_email_id`, `from_email_address`, `to[]`, `parent_id`, `attachments[]`. No dated filter.
- `GET /api/replies/{id}`: one reply.

### Senders

- `GET /api/sender-emails`: filters `search`, `tag_ids`, `status` (`connected`, `not_connected`, `pending_move`, `pending_deletion`), warmup score. A sender: `name`, `email`, `email_signature`, `imap_server`, `imap_port`, `smtp_server`, `smtp_port`, `daily_limit`, `type` (`Inbox` in the list example; `microsoft_oauth`, `google_workspace_oauth`, `custom` in nested examples), `status` (`Connected`), `warmup_enabled`, lifetime counts (`emails_sent_count`, `total_replied_count`, `total_opened_count`, `unsubscribed_count`, `bounced_count`, `unique_replied_count`, `unique_opened_count`, `total_leads_contacted_count`, `interested_leads_count`), `tags[]`. No password is in any documented response.
- `GET /api/sender-emails/{senderEmailId}`: one sender. `.../campaigns` lists its campaigns; `.../replies` its replies.
- `GET /api/warmup/sender-emails` and `.../{senderEmailId}`: warmup counts and `warmup_score` between two required dates.
- `GET /api/sender-emails/{senderEmailId}/oauth-access-token`: **returns the mailbox's OAuth access token.** Refused by `raw`, left out of the native catalog.

### Workspace and account

- `GET /api/workspaces/v1.1` and `.../{team_id}`: workspaces. **Each carries `webhooks_secret_key`**, so the reads are refused by `raw` and the key is dropped from every normalized record's `raw`. The deprecated v1 reads return the same records, secret included, and are refused too.
- `GET /api/workspaces/v1.1/stats`: totals between two required dates, as strings, with vendor percentages beside them.
- `GET /api/workspaces/v1.1/line-area-chart-stats`: the daily series, as above.
- `GET /api/campaign-events/stats`: the daily series, filtered by `campaign_ids` and `sender_email_ids`.
- `GET /api/users`: the key's user and team.
- `GET /api/workspaces/v1.1/master-inbox-settings`: three inbox settings.

### Lists, block list, tags, webhooks

- `GET /api/lead-lists`, `.../{id}`: `name`, `status`, `leads_processed`, `leads_succeeded`, `leads_failed`, `created_at`. No read returns the leads of a list.
- `GET /api/blacklisted-emails` (`email`) and `GET /api/blacklisted-domains` (`domain`), and one of each by id.
- `GET /api/tags` (unpaginated in the example), `GET /api/tags/{id}`.
- `GET /api/webhook-url`, `.../{id}`: `name`, `url`, `events[]` (lowercase event ids), `created_at`. No per-campaign scope and no active flag.
- `GET /api/webhook-events/event-types`, `.../sample-payload`, `GET /api/events`, `GET /api/webhook-deliveries/{id}`, `GET /api/webhook-attempts/{id}`.

### Other reads

Custom variables, custom tracking domains, ignore phrases, reply templates, schedule templates, timezones, sending schedules, OAuth sessions. `GET /api/oauth-sessions/{id}` returns a sign-in URL for the session, which is not a credential.

## Webhooks

- Registered per workspace with `POST /api/webhook-url` (`name`, `url`, `events`). The 23 event ids, from `GET /api/webhook-events/event-types` and the `type` filter of `GET /api/events`: `email_sent`, `email_send_failed`, `manual_email_sent`, `manual_email_send_failed`, `lead_first_contacted`, `lead_replied`, `lead_interested`, `lead_unsubscribed`, `untracked_reply_received`, `email_opened`, `email_bounced`, `email_account_added`, `email_account_removed`, `email_account_disconnected`, `email_account_reconnected`, `tag_attached`, `tag_removed`, `warmup_disabled_causing_bounces`, `warmup_disabled_receiving_bounces`, `blacklisted_email_added`, `blacklisted_email_removed`, `blacklisted_domain_added`, `blacklisted_domain_removed`. The event-types example lists 19 of them.
- Payload: `{ "event": { "type": "EMAIL_SENT", "name": "Email Sent", "instance_url", "workspace_id", "workspace_name" }, "data": { ... } }`. The type is the event id in upper case.
- Documented payloads: `EMAIL_SENT` (the sample-payload example: `scheduled_email`, `campaign_event`, `lead`, `campaign`, `sender_email`), `MANUAL_EMAIL_SENT` (inside the `GET /api/events` example: `reply`, `sender_email`, `lead`, `campaign`, `scheduled_email`) and `TAG_ATTACHED` (developer page: `tag_id`, `tag_name`, `taggable_id`, `taggable_type`). "The event payload matches the webhook payload exactly" (events page), so the `GET /api/events` example is a webhook body.
- No other event has a documented payload. The UI shows samples "under the toggle", which is not public. The adapter reads the other events with the same `data` keys.
- **No event id** is in the payload, so the adapter derives one from the event type and the ids in `data`.
- **Signing:** each workspace has a `webhooks_secret_key` (`webhooks_sig_...`), which suggests signed deliveries, but no page says which header carries a signature or how it is computed. The adapter does not verify signatures; `events.verify` is `secret` (a secret in the URL), as for vendors that do not sign.
- Delivery: an attempt times out after 15 seconds; failed deliveries are retried "up to five times across the next twenty four hours" (developer page). Events are kept for 10 days and can be replayed.
- `Contact Replied` does not fire for an automatic reply when the campaign's "Include auto replies in stats" is off.

## How the adapter reads each normalized record

- **Campaign:** `id`, `name`, `status` mapped (`active`, `launching`, `queued` → active; `paused` → paused; `completed`, `stopped` → completed; `draft` → draft; `archived` → archived; `failed`, `pending deletion`, `deleted` → unknown), `created_at`, tag names. Status is matched case-insensitively.
- **Sequence:** steps without `variant: true` in `order`, each with itself as variant A; a variant joins the step its `variant_from_step_id` names, or, when that is `null`, the step with the same `order`. `delayDays` is `wait_in_days`.
- **Sender:** `email`, `name`, `daily_limit`, `status` (`connected` → active, `not_connected` → disconnected, else unknown), `type` (`google*` → google, `microsoft*` → microsoft, `custom`/imap → smtp, else null), `warmup_enabled`, tag names.
- **Lead:** names, email, title, company, custom variables as `custom`, `overall_stats` as engagement (`opens` is total opens, `replies` total replies), `created_at`. `status`: verification `bounced` sets bounced, `unsubscribed` sets unsubscribed; `overall_stats.replies > 0` sets replied. Progress from `lead_campaign_data.status` on a campaign's leads.
- **Message:** a sent scheduled email (`sent_at`, `email_subject`, `email_body`, step and sender), or a reply record (in unless `folder` is `Sent`).
- **Reply:** a reply record with `folder` other than `Sent`. Category: `interested` → positive, else `automated_reply` → ooo with `isAuto`, else unknown.
- **Stats:** workspace and campaign totals from the summary reads (strings parsed as numbers); daily rows from the line-area series; a sender's lifetime counts from its record; step rows from the campaign summary's `sequence_step_stats`.

## Unverified or unclear

- The rate limit (see above).
- Whether the page size can be changed. Nothing says so; the adapter reads 15 per page.
- Every response shape: examples are hand-written and several are invalid JSON.
- What `lead_campaign_data.status` holds besides `stopped`.
- Whether `opened` and `opens` count every open or unique opens; the adapter takes the plain names as totals and the `unique_` names as unique.
- Whether `replied` on a campaign includes automatic replies (a campaign setting decides).
- Whether the summary stats count days in UTC or in the campaign's timezone.
- How webhooks are signed, and the payloads of 20 of the 23 events.
- Whether `GET /api/tags` is paginated (the example has no `meta`).
- Whether `variant_from_step_id` is ever set (the example shows a variant with `null`).
- How booleans are written in a query. The reference is generated by Scribe from a Laravel app (inferred from its format and the `bison.test` example host), and Laravel's boolean rule takes `1` and `0` but not `true` and `false`, so the adapter sends `read=1` or `read=0`.
- Whether a `super-admin` key's workspace changes under a running process (the docs say it follows the user).

## Tracking settings behind open counts (2026-11-16, for OUT-89)

Fetched 2026-11-16: `https://dedi.emailbison.com/api/reference.openapi`. `GET /api/campaigns` and `GET /api/campaigns/{id}` return `open_tracking` (boolean) on each campaign, beside lifetime counts. No click-tracking setting exists on a campaign, so clicks are not judged. The listing's counts are lifetime only, and the dated per-campaign read (`POST /api/campaigns/{id}/stats`) is one request per campaign, so workspace and sender rows are not judged for tracking.
