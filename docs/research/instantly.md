# Instantly (instantly.ai) API V2 — research for a read-only adapter

> This is the research record the Instantly adapter was written from. The companion files it mentions (`endpoints.json`, `sources/`, `_gen/`) were working files and are not in this repository; the fixtures used by the tests are in `fixtures/instantly/`.

The sections below were fetched 2026-11-14 from public documentation only and describe the API "as documented". Later the same day the adapter was run, read-only, against one live workspace; what that run showed is in "Live run, 2026-11-14" at the end, and it overrides anything above that it contradicts. The primary source is the OpenAPI 3.1 spec at `https://api.instantly.ai/openapi/api_v2.json` (268 operations, `info.version` 2.0.0), which the Mintlify docs site is generated from. Field names below are copied from that spec. A copy is in `sources/api_v2.openapi.json`.

Companions in this folder: `endpoints.json` (37 operations with every parameter and response field), `limits.json`, `fixtures/`, `sources/` (raw downloaded documents), `_gen/gen.py` (rebuilds the JSON deliverables from the spec).

## 0. Basics that apply to every endpoint

| Topic | Documented value |
| --- | --- |
| Base URL | `https://api.instantly.ai/api/v2` (spec `servers[0].url` = `https://api.instantly.ai`, paths start `/api/v2/`) |
| Auth | Header `Authorization: Bearer <API_KEY>`. The docs write the header name lower-case (`authorization`) with value `Bearer {{key}}`. |
| Keys | Created in the app (Settings > Integrations > API Keys), shown once. Each key carries scopes. V1 keys do not work on V2. |
| Scopes | `<resource>:<read\|create\|update\|delete\|all>` plus `all:read`, `all:all` etc. A read-only adapter is fully served by a key with `all:read`. Each endpoint lists its accepted scopes (in `endpoints.json` as `scopes_any_of`). |
| Workspace scoping | One key = one workspace. Exception: a key from an "admin workspace" of a workspace group can act as any sub workspace by adding header `x-as-workspace: <sub workspace id>` (section 8). |
| Pagination | Cursor. Request `limit` (integer, min 1, max 100, default not documented) and `starting_after`; the response is `{ "items": [...], "next_starting_after": "..." }`. Pass `next_starting_after` back as `starting_after`. The cursor is opaque: "this could either be a UUID, a timestamp, on an email depending on the specific API". |
| End of list | Not documented. `next_starting_after` is optional in the schema, so presumably absent on the last page. UNVERIFIED. |
| Timestamps | ISO 8601 UTC strings, fields named `timestamp_*`. |
| Versioning | Path version `/api/v2`. No date-based or header versioning. V1 "was deprecated on January 19, 2026"; V1 and V2 are incompatible. |
| Plan | Help center: "API access is available on all Outbound plans." Every endpoint documents `402` "Workspace does not have an active paid plan". Webhooks need Hyper Growth or above (section 9). |

### Error shape

All documented error responses share one shape:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Missing Authorization header"
}
```

| Status | `error` | Meaning as documented |
| --- | --- | --- |
| 400 | `Bad Request` | Invalid request body or parameters; `message` example `body must have required property 'name'` |
| 401 | `Unauthorized` | "the Authorization header is missing or invalid, or the API key has been revoked" |
| 402 | `Payment Required` | "the workspace does not have an active paid plan" |
| 403 | (in spec on 26 operations) | Quickstart: "the API key does not have the required scope" |
| 404 | `Not Found` | `message` example `Resource not found` |
| 413 |  | Only on `GET /accounts/analytics/daily`: "The analytics request is too large for the requested workspace or date range." |
| 429 | `Too Many Requests` | `message` example `Rate limit exceeded` |

401, 402, 404 and 429 are declared on every operation. 403 is declared on only 26 of 268 operations in the spec even though a missing scope can presumably happen anywhere (UNVERIFIED).

### Rate limits

- "No more than 100 requests per second" and "No more than 6,000 requests per minute". Either limit blocks requests.
- Scope: "the entire Workspace, even if it's using multiple API keys", and "shared between API v2 and API v1".
- Over the limit: HTTP `429`. No rate-limit headers and no `Retry-After` are documented for the general API. The spec declares a `Retry-After` header only on the 429 of two SuperSearch endpoints.
- **`GET /api/v2/emails` has its own limit: "20 requests per minute, unlike other API endpoints."** At 100 items a page that is at most 2,000 emails a minute. The scope of this limit (workspace or key) is not stated. `GET /emails/{id}` has no special limit documented.
- Other per-endpoint limits exist only on write/utility endpoints (see `limits.json`).

## 1. Campaigns

| Operation | Endpoint |
| --- | --- |
| List | `GET /api/v2/campaigns` |
| Get one | `GET /api/v2/campaigns/{id}` (`id` uuid) |
| Campaigns a lead email is in | `GET /api/v2/campaigns/search-by-contact?search=<lead email>` (returns `{ items }`, no cursor documented) |
| Why a campaign is not sending | `GET /api/v2/campaigns/{id}/sending-status` |

List query params: `limit`, `starting_after`, `search` (campaign name), `tag_ids` (comma-separated), `ai_sales_agent_id`, `status`, `exclude_status`, `include_ai_sales_agent_campaigns` (boolean; AI-agent campaigns are excluded by default). There is no date filter and no sort parameter.

Campaign `status` is a number:

| Value | Meaning              |
| ----- | -------------------- |
| `0`   | Draft                |
| `1`   | Active               |
| `2`   | Paused               |
| `3`   | Completed            |
| `4`   | Running Subsequences |
| `-99` | Account Suspended    |
| `-1`  | Accounts Unhealthy   |
| `-2`  | Bounce Protect       |

`not_sending_status` (number or null): `1` not within sending schedule, `2` waiting for a lead to process, `3` campaign daily limit reached, `4` all sending accounts reached their daily limit, `99` error (contact support).

Main campaign fields (full list with types in `endpoints.json`): `id`, `name`, `status`, `timestamp_created`, `timestamp_updated`, `campaign_schedule` (`start_date`, `end_date`, `schedules[]` with `name`, `timing.from/to`, `days` keyed `"0"`..`"6"`, `timezone`), `sequences`, `email_list` (sending account emails), `email_tag_list` (tag uuids), `daily_limit`, `daily_max_leads`, `email_gap`, `random_wait_max`, `stop_on_reply`, `stop_on_auto_reply`, `link_tracking`, `open_tracking`, `text_only`, `first_email_text_only`, `is_evergreen`, `pl_value`, `not_sending_status`, `organization` (the workspace id), `owned_by`, `created_by`, `ai_sdr_id`, `cc_list`, `bcc_list`, `core_variables`, `custom_variables`, `provider_routing_rules`, `auto_variant_select`. Required in the schema: `id`, `name`, `status`, `campaign_schedule`, `timestamp_created`, `timestamp_updated`.

The sending-status endpoint returns `diagnostics.status`, one of: `campaign_paused`, `campaign_draft`, `campaign_completed`, `campaign_running_subsequences`, `campaign_bounce_protect`, `campaign_accounts_unhealthy`, `campaign_account_suspended`, `out_of_schedule`, `waiting_for_lead_timezone_window`, `invalid_lead_timezone_configuration`, `waiting_for_leads`, `daily_limit_met`, `account_daily_limit_met`, `account_slow_ramp_limit_met`, `new_lead_limit_met`, `all_accounts_unhealthy`, `waiting_for_esp_match`, `domain_limit_reached`, `follow_up_delay_not_met`, `no_accounts_available`, `healthy`.

## 2. Sequence / steps / variants

There is no sequence endpoint. The copy is inside the campaign object (returned by both list and get):

```
sequences[0].steps[] = { type: "email", delay: number, delay_unit: "minutes"|"hours"|"days" (default "days"),
                         pre_delay, pre_delay_unit,            // subsequences only
                         variants[] = { subject: string, body: string (HTML), v_disabled?: boolean } }
```

- "Even though this field is an array, only the first element is used."
- `delay` is "the delay value before sending the NEXT email", so it belongs to the gap after the step, not before it.
- Steps and variants have no ids in this schema. Analytics refer to them by position: step `"1"`.., variant `"0"`.. (0 = A). Webhooks say variant starts at 1. See "Unverified".
- `type` is always `"email"`.

Subsequences (follow-up sequences triggered by a label, activity or reply text) are a separate resource: `GET /api/v2/subsequences?parent_campaign=<campaign id>` and `GET /api/v2/subsequences/{id}`. They carry their own `sequences[].steps[].variants[]`, `status` (same numbers as campaigns), `conditions` (`crm_status[]`, `lead_activity[]`, `reply_contains`) and `subsequence_schedule`.

## 3. Senders (email accounts)

| Operation | Endpoint |
| --- | --- |
| List | `GET /api/v2/accounts` |
| Get one | `GET /api/v2/accounts/{email}` (keyed by email address, not uuid) |
| Campaigns using an account | `GET /api/v2/account-campaign-mappings/{email}` |
| Warmup analytics | `POST /api/v2/accounts/warmup-analytics` (POST for a read) |
| Per-day sending stats | `GET /api/v2/accounts/analytics/daily` |

List params: `limit`, `starting_after` ("in `timestamp_created&email` format. Legacy ISO date-time cursor is still supported"), `search`, `status`, `provider_code`, `tag_ids` (any), `tag_ids_all` (all), `filter`, `include_tags`, `sort_by` (`timestamp_created`, `email`, `stat_warmup_score`, `status`), `sort_order`, `skip` (offset, "used with `sort_by` when cursor pagination is not available").

Account fields: `email`, `first_name`, `last_name`, `status`, `warmup_status`, `provider_code`, `daily_limit`, `daily_limit_max`, `warmup_limit_max`, `sending_gap` (minutes), `enable_slow_ramp`, `stat_warmup_score`, `timestamp_warmup_start`, `warmup` (`limit`, `increment`, `reply_rate`, `warmup_custom_ftag`, `advanced.*`), `tracking_domain_name`, `tracking_domain_status`, `status_message` (`code`, `command`, `response`, `e_message`, `responseCode`), `setup_pending`, `is_managed_account`, `signature`, `reply_to`, `autofix_failed`, `organization`, `added_by`, `modified_by`, `timestamp_created`, `timestamp_updated`, `tags` (only with `include_tags=true`).

| Enum | Values |
| --- | --- |
| `status` | `1` Active, `2` Paused, `3` Temporarily paused for maintenance, `-1` Connection Error, `-2` Soft Bounce Error, `-3` Sending Error |
| `warmup_status` | `0` Paused, `1` Active, `-1` Banned, `-2` Spam Folder Unknown, `-3` Permanent Suspension |
| `provider_code` | `1` Custom IMAP/SMTP, `2` Google, `3` Microsoft, `4` AWS, `8` AirMail, `11` Airmail Instant |
| `filter` (query) | `ACC_FILTER_PAUSED`, `ACC_FILTER_ERROR`, `ACC_FILTER_NO_CTD`, `ACC_FILTER_PW_ACCOUNTS`, `ACC_FILTER_DFY`, `ACC_FILTER_DFY_SETUP_PENDING`, `ACC_FILTER_W_ACTIVE`, `ACC_FILTER_W_PAUSED`, `ACC_FILTER_W_ERROR` |

Warmup analytics: body `{ "emails": ["a@x.com", ...] }` (required; no documented maximum). Response is keyed by email:

```
email_date_data[<email>][<YYYY-MM-DD>] = { sent, landed_inbox, landed_spam, received }
aggregate_data[<email>] = { sent, received, landed_inbox, landed_spam, health_score_label, health_score }
```

Keys with a zero count are simply missing in the documented example (`landed_spam`, `received`). No date range parameter exists; the window covered is not documented. This is the one endpoint with a real documented example (`fixtures/getAccountWarmupAnalytics.json`).

Instantly has no LinkedIn accounts or seats in this API.

## 4. Leads

| Operation | Endpoint |
| --- | --- |
| List | `POST /api/v2/leads/list` (**POST for a read**; every filter and the cursor go in the JSON body) |
| Get one | `GET /api/v2/leads/{id}` |
| Lead lists | `GET /api/v2/lead-lists` |

Body fields: `campaign` (campaign uuid), `list_id`, `in_campaign`, `in_list`, `search`, `filter`, `ids[]`, `excluded_ids[]`, `contacts[]` (emails), `queries[]` (smart-view conditions), `smart_view_id`, `organization_user_ids[]`, `is_website_visitor`, `distinct_contacts`, `enrichment_status`, `esg_code`, `limit` (1..100), `starting_after`. With no `campaign`/`list_id` the list is workspace-wide.

- Ordering: "by each lead's `id` field in ascending order (or by `contact` when distinct_contacts is true)". Leads created on or after October 15, 2025 are chronological by id; "older records may appear out of sequence".
- Cursor: the last lead's `id`, or its email when `distinct_contacts` is true.
- A lead row is per campaign/list membership: the same email in two campaigns is two leads with different `id` (inferred from the `campaign`/`list_id` fields on the lead and the `distinct_contacts` option; not stated outright).
- No date filter (no `updated_since`). The only time-based filtering is `queries[].values["occurrence-days"]`.

Lead `status`: `1` Active, `2` Paused, `3` Completed, `-1` Bounced, `-2` Unsubscribed, `-3` Skipped.

Lead interest status, field **`lt_interest_status`** (number): `0` Out of Office, `1` Interested, `2` Meeting Booked, `3` Meeting Completed, `4` Won, `-1` Not Interested, `-2` Wrong Person, `-3` Lost, `-4` No Show. "It can be either a static value, or a custom status interest value": custom labels get their own number, found as `interest_status` on `GET /api/v2/lead-labels`, whose `interest_status_label` (`positive`, `negative`, `neutral`) tells you the sentiment. Subsequence conditions bound these numbers to -30000..30000.

`verification_status`: `0` Not verified, `1` Verified, `11` Pending, `12` Pending Verification Job, `-1` Invalid, `-2` Risky, `-3` Catch All, `-4` Job Change.

Other lead fields: `id`, `email`, `first_name`, `last_name`, `company_name`, `company_domain`, `job_title`, `phone`, `website`, `personalization`, `campaign`, `list_id`, `subsequence_id`, `organization`, `payload`, `status_summary`, `status_summary_subseq`, `email_open_count`, `email_reply_count`, `email_click_count`, `email_opened_step`, `email_opened_variant`, `email_replied_step`, `email_replied_variant`, `email_clicked_step`, `email_clicked_variant`, `last_step_from`, `last_step_id`, `last_step_timestamp_executed`, `timestamp_created`, `timestamp_updated`, `timestamp_last_contact`, `timestamp_last_open`, `timestamp_last_reply`, `timestamp_last_click`, `timestamp_last_interest_change`, `timestamp_last_touch`, `timestamp_added_subsequence`, `pl_value_lead`, `assigned_to`, `uploaded_by_user`, `upload_method` (`manual`, `api`, `website-visitor`), `is_website_visitor`, `enrichment_status`, `esp_code`, `esg_code`, `last_contacted_from`.

Custom fields live in **`payload`**: an object with any keys whose values are "string, number, boolean, or null" (no objects or arrays). The documented example keys are camelCase (`firstName`, `lastName`, `companyName`, `jobTitle`, `website`, `phone`, `personalization`) and duplicate the snake_case top-level fields.

`filter` values: `FILTER_VAL_CONTACTED`, `FILTER_VAL_NOT_CONTACTED`, `FILTER_VAL_COMPLETED`, `FILTER_VAL_UNSUBSCRIBED`, `FILTER_VAL_ACTIVE`, `FILTER_VAL_BOUNCED`, `FILTER_VAL_SKIPPED`, `FILTER_VAL_RISKY`, `FILTER_VAL_INVALID`, `FILTER_VAL_VALID`, `FILTER_VAL_CATCH_ALL`, `FILTER_VAL_NOT_VERIFIED`, `FILTER_VAL_IN_SUBSEQUENCE`, `FILTER_VAL_OPENED_NO_REPLY`, `FILTER_VAL_COMPLETED_NO_REPLY`, `FILTER_VAL_NO_OPENS`, `FILTER_VAL_REPLIED`, `FILTER_VAL_LINK_CLICKED`, `FILTER_LEAD_INTERESTED`, `FILTER_LEAD_NOT_INTERESTED`, `FILTER_LEAD_MEETING_BOOKED`, `FILTER_LEAD_MEETING_COMPLETED`, `FILTER_LEAD_CLOSED`, `FILTER_LEAD_OUT_OF_OFFICE`, `FILTER_LEAD_WRONG_PERSON`, `FILTER_LEAD_LOST`, `FILTER_LEAD_NO_SHOW`, `FILTER_LEAD_CUSTOM_LABEL_POSITIVE`, `FILTER_LEAD_CUSTOM_LABEL_NEGATIVE`.

## 5. Messages (emails sent and received)

| Operation | Endpoint |
| --- | --- |
| List | `GET /api/v2/emails` (20 requests/minute) |
| Get one | `GET /api/v2/emails/{id}` |
| Unread count | `GET /api/v2/emails/unread/count` returns `{ "count": number }` |

One resource covers everything visible in the Unibox: "A campaign email, a reply, a manually sent email, or any other email". Direction is `ue_type`: `1` Sent from campaign, `2` Received, `3` Sent, `4` Scheduled.

Query params: `limit`, `starting_after`, `campaign_id`, `list_id`, `lead` (lead email), `eaccount` (sending account, comma-separated for several), `email_type` (`received`, `sent`, `manual`), `search` (a lead email, or `thread:<thread uuid>`), `i_status` (number), `is_unread`, `has_reminder`, `mode` (`emode_focused`, `emode_others`, `emode_all`), `preview_only`, `sort_order` (`asc`/`desc`, by creation date, default `desc`), `scheduled_only`, `assigned_to`, `company_domain`, `marked_as_done`, `latest_of_thread`, `min_timestamp_created`, `max_timestamp_created` (ISO timestamps; these filter on `timestamp_created`, the time Instantly stored the email, not `timestamp_email`).

Bodies are returned: `body: { text, html }`. In list responses a large body may be cut: `body_fallback_reason` is `too_large` or `unavailable`, and then `body` "holds at most a plain-text excerpt (`text`, no `html`) and may be empty. Get the full body from `GET /api/v2/emails/{id}`."

Email fields: `id`, `timestamp_created`, `timestamp_email`, `message_id`, `subject`, `from_address_email`, `to_address_email_list` (comma-separated string), `cc_address_email_list`, `bcc_address_email_list`, `reply_to`, `body`, `content_preview`, `organization_id`, `campaign_id`, `subsequence_id`, `list_id`, `lead` (lead email), `lead_id`, `eaccount`, `ue_type`, `step` (string), `is_unread` (number), `is_auto_reply` (number 0/1), `ai_interest_value` (number, example 0.75), `ai_assisted`, `is_focused`, `i_status`, `thread_id`, `reminder_ts`, `attachment_json`, `from_address_json`, `to_address_json`, `cc_address_json`, `ai_agent_id`, `body_fallback_reason`.

## 6. Replies and reply categories

No separate replies endpoint. Replies are `GET /api/v2/emails?email_type=received` (rows with `ue_type` 2), optionally with `campaign_id` or `lead`. Useful per-reply fields: `is_auto_reply`, `i_status` ("Indicates the interest status of the email"; values not enumerated, parameter examples are 1, 2, 3), `ai_interest_value`, `thread_id`.

The category of a reply is really a property of the lead, `lt_interest_status` (section 4). There is no sentiment field other than the `interest_status_label` (`positive`/`negative`/`neutral`) of custom lead labels. `AI Inbox Manager` endpoints (`/api/v2/ai-agents/inbox-manager/{id}/replies`) list AI-drafted replies, which is a different thing and not needed for a read adapter.

## 7. Analytics

All four campaign analytics endpoints take `start_date` / `end_date` ("a date-only value (`YYYY-MM-DD`) or a full ISO 8601 timestamp. Date-only values are interpreted as UTC midnight"). None is paginated. No default range is documented.

| Scope | Endpoint | Response |
| --- | --- | --- |
| Per campaign totals | `GET /api/v2/campaigns/analytics` with `id` or repeated `ids=` (empty = all), `exclude_total_leads_count` | bare array, one object per campaign |
| Aggregate totals | `GET /api/v2/campaigns/analytics/overview` with `id`, `ids`, `campaign_status`, `expand_crm_events` | one object (summed across the selected campaigns) |
| Per day | `GET /api/v2/campaigns/analytics/daily` with `campaign_id` (one or none), `campaign_status` | bare array, one object per date |
| Per step and variant | `GET /api/v2/campaigns/analytics/steps` with `campaign_id`, `include_opportunities_count` | bare array |
| Per sender per day | `GET /api/v2/accounts/analytics/daily` with `emails` (required, max 200), `start_date`, `end_date` (max range 31 days, default 30 days ending today) | bare array |
| Per subsequence | `GET /api/v2/subsequences/analytics?campaign_id=` (required) | bare array of `subsequence_id`, `emails_sent`, `unique_opens`, `unique_replies` |

Field names differ between the endpoints:

| Count | `/analytics` and `/analytics/overview` | `/analytics/daily`, `/analytics/steps`, accounts daily |
| --- | --- | --- |
| Sent | `emails_sent_count` | `sent` |
| Leads contacted | `contacted_count`, `new_leads_contacted_count` | `contacted`, `new_leads_contacted` (not in steps) |
| Opens total / unique | `open_count` / `open_count_unique`, `open_count_unique_by_step` | `opened` / `unique_opened` |
| Replies total / unique | `reply_count` / `reply_count_unique`, `reply_count_unique_by_step` | `replies` / `unique_replies` |
| Auto replies | `reply_count_automatic`, `reply_count_automatic_unique`, `reply_count_automatic_unique_by_step` | `replies_automatic`, `unique_replies_automatic` |
| Clicks | `link_click_count`, `link_click_count_unique`, `link_click_count_unique_by_step` | `clicks`, `unique_clicks` |
| Bounced | `bounced_count` | `bounced` (accounts daily only) |
| Unsubscribed | `unsubscribed_count` | not available |
| Completed | `completed_count` | not available |
| Opportunities | `total_opportunities`, `total_opportunity_value` | `opportunities`, `unique_opportunities` (campaign daily; steps only with the flag, plus `meetings_booked`, `won`) |
| Positive / interested | overview only: `total_interested`, `total_meeting_booked`, `total_meeting_completed`, `total_closed` | not available |

Notes:

- There is no "delivered" count anywhere. Bounces per day or per step for a campaign are not available.
- `/analytics` adds `campaign_name`, `campaign_id`, `campaign_status`, `campaign_is_evergreen`, `leads_count`.
- `open_count` is described as "the number of leads that opened at least one email" on `/analytics` but "the total number of times the emails were opened, including duplicates" on `/overview`. Contradictory, see "Unverified".
- `reply_count_unique` "excludes automatic replies".
- Positive counts are opportunity events: by default "the first occurrence of each event per contact"; `expand_crm_events=true` counts every status change. A 10 minute window suppresses duplicate status changes.
- Steps: `step` is a string or null ("1"..), `variant` a string or null ("0" = A). Null means the event could not be tied to a step, "for instance for list leads".
- Accounts daily returns `date`, `email_account`, `sent`, `bounced`, `contacted`, `new_leads_contacted`, `opened`, `unique_opened`, `replies`, `unique_replies`, `replies_automatic`, `unique_replies_automatic`, `clicks`, `unique_clicks`; it can answer `413`.

## 8. Workspaces, clients, sub-accounts

- A key belongs to exactly one workspace. `GET /api/v2/workspaces/current` "will return the workspace based on the API key sent in the headers" (`id`, `name`, `owner`, `plan_id`, `timestamp_created`, ...). There is no endpoint that lists all workspaces of a user.
- Agencies: a "workspace group" has one admin workspace and sub workspaces. "You can use a single API key to manage any of your sub workspaces. It works with **all** API endpoints." Add header `x-as-workspace` with the sub workspace `id`. Without the header the call hits the key's own workspace.
- Sub workspaces are listed with `GET /api/v2/workspace-group-members` (cursor-paginated): `id` (the membership id), `admin_workspace_id`, `sub_workspace_id`, `sub_workspace_name`, `admin_workspace_name`, `status` (`pending`, `accepted`, `rejected`), `billing_shared`, timestamps. Only `accepted` members can sensibly be impersonated (inference, not stated).
- `GET /api/v2/workspace-group-members/admin` tells a workspace whether it has an admin workspace (`has_admin_workspace`, `workspace_name`, ...).
- A workspace cannot be both admin and sub.
- Resources carry the workspace id under inconsistent names: `organization` (campaign, account, lead, webhook), `organization_id` (email, lead label, lead list, tag, API key, webhook event), `workspace` (subsequence, webhook payload), `workspace_id` (workspace member).
- `GET /api/v2/workspace-members` lists human users, not clients.

## 9. Webhooks

Registration (API): `POST /api/v2/webhooks` with `target_hook_url` (required), `event_type`, `campaign` (uuid or null = all campaigns), `name`, `custom_interest_value` (for custom label events), `headers` (object of static HTTP headers Instantly will send). Also `GET /api/v2/webhooks`, `GET/PATCH/DELETE /api/v2/webhooks/{id}`, `POST /api/v2/webhooks/{id}/test`, `POST /api/v2/webhooks/{id}/resume`, `GET /api/v2/webhooks/event-types` (returns `{ event_types: [{ id, label, type }] }`, including custom labels). One webhook = one `event_type` (or `all_events`). Webhook `status`: `1` active, `-1` error (disabled after delivery failures), with `timestamp_error`.

Delivery log: `GET /api/v2/webhook-events` (filters `success`, `from`, `to` as YYYY-MM-DD, `search`), plus `/webhook-events/{id}`, `/summary`, `/summary-by-date`. Rows include `payload`, `success`, `retry_count`, `will_retry`, `status_code`, `timestamp_next_retry`, `lead_email`, `response_time_ms`, so retries exist, but the retry schedule is not documented.

**Signatures: none documented.** No signing secret, HMAC or signature header appears in the spec, the webhook guide or the help center. The only verification mechanism is the static `headers` you configure (example `{"Authorization": "Basic ..."}`). Third-party pages mentioning an `x-instantly-signature` header are not backed by any Instantly document.

**Plan gating:** help center: "This feature is available on the Hyper Growth plan or above." (API access itself is on all Outbound plans.)

Event type names. The spec enum (create/patch webhook) is:

`all_events`, `email_sent`, `email_opened`, `email_link_clicked`, `reply_received`, `email_bounced`, `lead_unsubscribed`, `campaign_completed`, `account_error`, `lead_neutral`, `lead_interested`, `lead_not_interested`, `lead_meeting_booked`, `lead_meeting_completed`, `lead_closed`, `lead_out_of_office`, `lead_wrong_person`, `lead_no_show`, `supersearch_enrichment_completed`

The webhook guide instead lists `link_clicked` (not `email_link_clicked`) and an extra `auto_reply_received`, and omits `lead_no_show` and `supersearch_enrichment_completed`. The list-webhooks `event_type` filter enum also omits the last two. Custom labels: `event_type` is null on the webhook (matched by `custom_interest_value`), and in the payload "any custom label configured in your workspace will be sent as the `event_type` value as-is".

Payload (one generic schema for all events, HTTP POST, JSON):

- Always: `timestamp` (ISO), `event_type`, `workspace` (uuid), `campaign_id`, `campaign_name`.
- Optional: `lead_email`, `email_account`, `unibox_url` (reply events only), `step` (from 1), `variant` (from 1), `is_first`, `email_id`, `email_subject`, `email_text`, `email_html` (sent emails), `reply_text_snippet`, `reply_subject`, `reply_text`, `reply_html` (reply events).
- "Additional lead data fields from your database may appear as extra keys" at the top level (help center names `firstName`, `lastName`, `companyName`, `website`, `phone`), so custom lead variables can collide with base keys.
- The payload carries no event id and no lead id. `email_id` is the only stable identifier, and only on some events.

## 10. Whoami / key check

No dedicated endpoint. Use `GET /api/v2/workspaces/current` (scope `workspaces:read` or `all:read`): 200 gives the workspace id and name, 401 a bad key, 402 no paid plan. `GET /api/v2/api-keys` lists keys with their `scopes` but needs `api_keys:read`, and returns all keys of the workspace without marking the calling one.

## Changelog (last ~6 months)

Instantly publishes no API changelog. `developer.instantly.ai` has no changelog page (404), and the product changelog at `feedback.instantly.ai/changelog` covers product launches only. Product entries since June 2026:

| Date | Entry | API area now in the spec (my matching by name, not stated by Instantly) |
| --- | --- | --- |
| 2026-10-27 | "The Search is Over." | `creator-search`, `local-business-search` |
| 2026-09-29 | "Discover the New Instantly Experience" | none identified |
| 2026-09-22 | "The new Instantly Agents are here" | `/api/v2/ai-agents/sales`, `/inbox-manager` |
| 2026-08-20 | "Share Your Campaign Results" | `POST /api/v2/campaigns/{id}/share` |
| 2026-08-12 | "Turn company sources into targeted contacts" | `supersearch-enrichment/company-lists` |
| 2026-07-23 | "Never Run Out of Leads Again" | `/api/v2/ai-agents/lead-finder` |
| 2026-07-02 | "Go from idea to automation in seconds" | none identified |
| 2026-06-17 | "Introducing the AI Deliverability Agent" | `/api/v2/ai-agents/deliverability` |
| 2026-06-09 | "Autofill in SuperSearch is Live" | none identified |
| 2026-06-03 | "More control over workflows and security" | none identified |

Signs of recent API changes visible in the spec text itself: accounts cursor changed to `timestamp_created&email` ("Legacy ISO date-time cursor is still supported"); lead ordering by id guaranteed only for leads created on or after 2025-10-15; `delay_unit` added to steps ("Defaults to days for backward compatibility"); `body_fallback_reason` on emails; `lead_no_show` and `supersearch_enrichment_completed` webhook events. None of these is dated. The spec is regenerated continuously (example timestamps inside it are today's date), so it should be re-fetched rather than vendored once.

## 11. Read parity (added 2026-11-14)

Re-read on 2026-11-14 from `https://api.instantly.ai/openapi/api_v2.json` (`info.version` 2.0.0, 198 paths) and `https://developer.instantly.ai/llms.txt`. No API key was available when this section was written, so it describes the API as documented; "Live run, 2026-11-14" at the end records what was later observed. Each section names the endpoint, the fields the adapter reads and what is not confirmed.

### Campaign settings (`campaigns.settings`)

- `GET /api/v2/campaigns/{id}`. The settings are fields of the campaign object.
- Read: `daily_limit` (dailyLimit), `daily_max_leads` (dailyNewLeads), `email_gap` in minutes (gapMinutes), `text_only` (plainText), `stop_on_reply`, `stop_on_auto_reply`, `open_tracking`, `link_tracking`, `campaign_schedule.start_date`, `.end_date`, and each `campaign_schedule.schedules[]`: `name`, `timing.from`, `timing.to`, `timezone`, `days` (an object keyed `"0"` to `"6"` with a boolean each).
- Unconfirmed: which weekday `0` is. The adapter assumes 0 is Sunday. `timezone` is an IANA-style name from a fixed enum (for example `America/Chicago`, `Etc/GMT+12`).
- Not read, no place in the model: `random_wait_max`, `first_email_text_only`, `prioritize_new_leads`, `match_lead_esp`, `stop_for_company`, `insert_unsubscribe_header`, `allow_risky_contacts`, `disable_bounce_protect`, `limit_emails_per_company_override`, `cc_list`, `bcc_list`, `auto_variant_select`, `provider_routing_rules`.

### Campaign tags

- `GET /api/v2/custom-tag-mappings?resource_ids=<campaign ids, comma separated>` gives `tag_id` and `resource_id` per assignment (`resource_type` 1 account, 2 campaign, 3 workspace). `GET /api/v2/custom-tags?tag_ids=<ids>` gives each tag's `label`.
- A page of campaigns therefore costs three requests, one campaign two or three. Both lookups page at 100; the adapter follows up to 10 pages each and refuses (Provider error) beyond that instead of returning tags that are cut off.
- Scopes: `custom_tag_mappings:read` and `custom_tags:read`, or `all:read`. A key limited to `campaigns:read` cannot read tags; setting the `tags` capability to `false` skips both lookups.
- Unconfirmed: that `resource_id` is the campaign's uuid for campaigns (the schema says uuid; the search endpoint's example for accounts is an email address).

### Sequence delays (corrected)

- A step's `delay` is "the delay value before sending the NEXT email". The adapter used to report it on the step itself. Now a step's `delayDays` is the `delay` (in `delay_unit`) of the step before it, the first step of a campaign waits 0, and the first step of a subsequence waits its `pre_delay` (in `pre_delay_unit`), which the reference says is ignored for campaigns.

### Subsequences (`sequence.subsequences`)

- `GET /api/v2/subsequences?parent_campaign=<campaign id>`, cursor-paged (`limit` max 100, `starting_after`).
- Read: `id`, `name`, `parent_campaign`, `sequences[0].steps[]` (same step shape as a campaign).
- Not read, no place in the model: `conditions` (`crm_status`, `lead_activity`, `reply_contains`), `status`, `subsequence_schedule`, `daily_limit_mode`, `daily_limit`. They stay in `raw`.

### Campaign status filter (corrected)

- `GET /api/v2/campaigns?status=` takes one status number. Active covers 1 and 4 (running subsequences) and paused covers 2, -1, -2 and -99, so the adapter no longer sends a number for those two: it reads the page and keeps the matching campaigns. Draft (0) and completed (3) are still filtered by Instantly.

### A campaign's senders (`senders.byCampaign`)

- `GET /api/v2/campaigns/{id}` gives `email_list` (addresses) and `email_tag_list` (tag ids).
- `GET /api/v2/accounts` has `tag_ids` ("accounts that have any of the specified tags") and `include_tags` (adds `tags[]: { id, label, description }` to each account). It has no filter by a list of addresses.
- The adapter reads the campaign, then one page of accounts: with tags only it sends `tag_ids`; otherwise it reads every account (with `include_tags` when the campaign also names tags) and keeps those in `email_list` or carrying one of the tags. Two requests per page.
- Unconfirmed: that `email_tag_list` holds custom tag ids that match `tags[].id`.

### Sender health (`senders.health`)

- `GET /api/v2/accounts/{email}`: `status` (1 Active, 2 Paused, 3 temporarily paused for maintenance, -1 Connection Error, -2 Soft Bounce Error, -3 Sending Error), `warmup_status` (0 Paused, 1 Active, -1 Banned, -2 Spam Folder Unknown, -3 Permanent Suspension), `status_message.response`, `status_message.e_message`.
- `POST /api/v2/accounts/test/vitals` with `{ accounts: [email] }` (scope `accounts:read`): `success_list[]` and `failure_list[]` of `{ domain, allPass, mx, spf, dkim, dmarc, indeterminate[] }`. `indeterminate` names records "that could not be verified because the DNS resolver kept failing. They are reported as not passing, but the records may exist", so the adapter reports those as null.
- `POST /api/v2/accounts/warmup-analytics` with `{ emails: [email] }`: `aggregate_data[<email>]` = `{ sent, received, landed_inbox, landed_spam, health_score, health_score_label }`.
- connected is true for status 1, false for -1 and null otherwise. issues are the documented names of a failing status plus the two status message texts.
- Unconfirmed: the warmup analytics time window; whether the vitals test is throttled; whether `status_message` is cleared when an account recovers. blacklisted and checkedAt are not reported by any of the three.

### Lead engagement and interest (`leads.engagement`)

- On the lead object (`POST /api/v2/leads/list`, `GET /api/v2/leads/{id}`): `email_open_count`, `email_reply_count`, `email_click_count`, `timestamp_last_contact`, `timestamp_last_open`, `timestamp_last_reply`, `lt_interest_status`.
- `lt_interest_status`: 0 Out of Office, 1 Interested, 2 Meeting Booked, 3 Meeting Completed, 4 Won, -1 Not Interested, -2 Wrong Person, -3 Lost, -4 No Show, or the `interest_status` of a custom label. For any other number the adapter reads `GET /api/v2/lead-labels` (one page of 100) and uses that label's `label`; a reply with such an `i_status` takes its category from the label's `interest_status_label` (positive, negative, neutral).
- stepIndex is null: `last_step_id` is documented as a uuid, and `email_opened_step`, `email_replied_step` and `email_clicked_step` are the last step opened, replied to or clicked, not the last step sent.

### Lead lists (`lists.list`, `lists.leads`)

- `GET /api/v2/lead-lists`, cursor-paged: `id`, `name`, `timestamp_created`.
- `POST /api/v2/leads/list` with `list_id` lists a list's leads.
- size is null. `GET /api/v2/lead-lists/{id}/verification-stats` has `total_leads`, but it is one request per list and documents no scope, so it is not read.

### Block list (`blocklist`)

- `GET /api/v2/block-lists-entries`, cursor-paged: `id`, `bl_value`, `is_domain`, `timestamp_created`. kind is domain or email from `is_domain`, and other when the flag is missing.

### Tags (`tags`)

- `GET /api/v2/custom-tags`, cursor-paged: `id`, `label`, `description`. Tags apply to accounts, campaigns and workspaces.

### Webhook subscriptions (`webhooks.list`)

- `GET /api/v2/webhooks`, cursor-paged, optional `campaign` filter: `id`, `name`, `target_hook_url`, `event_type`, `campaign`, `status` (1 active, -1 disabled after delivery failures), `timestamp_created`.
- One webhook has one `event_type` (or `all_events`). For a custom lead label it is null and `custom_interest_value` holds the label's number; events is then empty.
- `headers` (the static headers Instantly sends, which can hold a credential) is part of the payload and so of `raw`.

### Messages by thread (`messages.byThread`)

- `GET /api/v2/emails?search=thread:<thread id>`: "a special string that starts with \"thread:\" to search for emails in a specific thread".

### Message bodies (`messages.body`: full)

- In a list, `body_fallback_reason` (`too_large` or `unavailable`) marks a body that is only an excerpt: "Get the full body from `GET /api/v2/emails/{id}`". When bodies are asked for, the adapter reads each such email on its own.
- Unconfirmed: whether `GET /api/v2/emails/{id}` shares the 20-per-minute limit of the list. The adapter counts it against that limit.

### Lookup by email (`leads.lookup`)

Read on 2026-11-14 from `https://developer.instantly.ai/api-reference/lead/list-leads.md` (the list-leads reference, which embeds the `POST /api/v2/leads/list` schema of `https://api.instantly.ai/openapi/api_v2.json`). No API key was available, so nothing here was observed live.

- `POST /api/v2/leads/list` takes `contacts`: an array of strings with `format: email`, "Array of emails the leads needs to have". The adapter sends the one address asked for, lowercased and trimmed by the core: `{ "contacts": ["person1@example.com"], "limit": 100 }`. It is the only filter on the address alone, so it is the one used.
- `search` is wider and was not used: "Search term matched against the lead's email and profile fields (first and last name, company, job title, and similar). Matches whole words, and the beginning of a field's value". It also says "Newly created or updated leads can take a few seconds to become searchable"; no such delay is documented for `contacts`.
- `contacts` goes with `campaign` or `list_id` in the same body, and the listing pages as before: `limit` (1 to 100) and `starting_after`, the `id` of the last lead of the page before.
- A lead is one record per campaign or list it is in, so one address can return several records.
- The adapter keeps only the records whose lowercased address equals the one asked for. A page can therefore hold fewer records than Instantly returned; the cursor is still Instantly's.
- The lead object has no LinkedIn profile field, so a lookup by profile returns an empty page without a request.
- Unconfirmed: that `contacts` compares whole addresses and not a part of one; whether it ignores case, and whether Instantly stores an address in the case it was uploaded in; whether `contacts` has a maximum length; and how `contacts` behaves with `distinct_contacts`, which the adapter never sends. `GET /api/v2/campaigns/search-by-contact?search=<email>` also finds a person's campaigns, but returns campaigns, not lead records, and documents no cursor, so it is not used here.

### Not available from the API

- `leads.since` stays `client`: `POST /api/v2/leads/list` has no creation-date filter. Its `queries[]` filter only on how many days ago an activity happened.
- `stats.bySender` stays `derived`: `GET /api/v2/accounts/analytics/daily` is the only per-mailbox analytics and it is per day; there is no total.
- Lead tags: custom tags attach to accounts, campaigns and workspaces only.
- A lead's last step position (`engagement.stepIndex`): only an id is given.
- A lead list's size (see above) and company lists: `supersearch-enrichment/company-lists` is a list-building job of the lead finder, not a saved list campaigns draw from.
- Sender health: block list status per mailbox (inbox placement reports are per test) and the time of the last check.
- `deletionDetection`: no list reveals deleted records.
- Webhook signature verification: Instantly does not sign webhooks.

## Unverified / unclear

1. **End of pagination.** How the last page is signalled (missing `next_starting_after`, null, or empty `items`) is not documented.
2. **Default `limit`** is not documented (only min 1, max 100).
3. **Webhook event names** conflict between the guide (`link_clicked`, `auto_reply_received`) and the spec enum (`email_link_clicked`, no auto-reply event). Which string arrives in `event_type` is unknown; accept both.
4. **Webhook payload per event** is not documented, only one generic schema. Which optional fields accompany which event is unknown; the `webhook.*.json` fixtures are guesses built from that schema.
5. **Webhook signing**: absence is inferred from silence in three official sources, not from a statement saying "we do not sign".
6. **Webhook retry policy** (count, spacing, when a webhook flips to status `-1`) is not documented.
7. **`open_count`** means leads on `/campaigns/analytics` and total opens on `/campaigns/analytics/overview`, according to the two descriptions.
8. **Variant numbering**: "0 = A" in step analytics, "starting at 1" in webhook payloads; lead fields `email_opened_variant` etc. do not say which. Step numbering starts at 1 in both.
9. **`i_status` on emails**: values not enumerated. Probably the same numbers as `lt_interest_status`; not stated.
10. **Email `step` field** is a string with example `"step-123"`; its real format (index, id, or composite) is unknown.
11. **`GET /emails` 20/min limit scope** (per workspace or per key) is not stated, and no headers reveal remaining quota.
12. **429 behaviour**: no `Retry-After` documented for general endpoints.
13. **Rate limit with `x-as-workspace`**: unknown whether the admin or the sub workspace is charged.
14. **403** is declared on only 26 operations; whether a missing scope returns 403 or 401 elsewhere is unknown.
15. **Analytics default date range** and whether `end_date` is inclusive are not documented. Account daily analytics does not state a timezone.
16. **Warmup analytics** time window and maximum number of `emails` per call are not documented.
17. **`search-by-contact`** documents no pagination; behaviour for a lead in more than 100 campaigns is unknown.
18. **Lead `filter` description** says "For custom lead labels, use the `interest_status` field", but the list body has no `interest_status` field. The nearest documented route is `queries[]` with `actionType: "lead-status"`.
19. **Plan names**: "all Outbound plans" for API access and "Hyper Growth plan or above" for webhooks come from the help center (articles dated October 9, 2026), not the developer docs.
20. The copy of the spec served at `https://developer.instantly.ai/api-reference/openapi.json` is smaller (167 operations) than `https://api.instantly.ai/openapi/api_v2.json` (268). All endpoints used here are in both.
21. **One lead row per campaign membership** (section 4) is my reading of the schema, not a documented statement.
22. **Whether `email_reply_count` counts automatic replies.** The lead schema says only "Number of times the email was replied to" (re-read 2026-11-15 from `https://api.instantly.ai/openapi/api_v2.json`, `info.version` 2.0.0). Campaign analytics separate them (`reply_count_unique` "excludes automatic replies"), the lead count does not say. Settling it needs a live workspace with a lead whose only reply is a known out-of-office. Until then `hotLeads` gives no reply points to a lead whose `lt_interest_status` is 0 (Out of Office).

## Endpoint inventory and native catalog (2026-11-14)

The whole reference was inventoried from the OpenAPI specification, fetched again on 2026-11-14 from `https://api.instantly.ai/openapi/api_v2.json`: 268 operations (115 `GET`, 99 `POST`, 24 `PATCH`, 1 `PUT`, 29 `DELETE`), the same 268 endpoint pages that `https://developer.instantly.ai/llms.txt` lists. `site/content/docs/coverage/instantly.mdx` has one row for each.

- **What counts as a read.** Every `GET`, and a `POST` only when its reference page lets a key with a `read` scope call it ("Requires one of the following scopes: `campaigns:read`, ..."). That rule gives 16 `POST` reads: the three the normalized reads use (`/leads/list`, `/accounts/test/vitals`, `/accounts/warmup-analytics`) and 13 in the native catalog. `POST /creator-search/search` and `POST /supersearch-enrichment/integrations/run` look like searches but need a `create` scope and can charge credits, so they are writes.
- **Excluded.** `GET /api-keys` returns each key in `key`. `GET /workspace-billing/plan-details`, `GET /workspace-billing/subscription-details` and `GET /oauth/session/status/{sessionId}` report nothing about campaigns, leads, senders or results.
- **Passwords.** `GET /dfy-email-account-orders/accounts` documents `with_passwords` ("Whether to include passwords in the response"). The catalog entry leaves that parameter out, so it cannot be sent.
- **Array query parameters.** `ids` on `GET /campaigns/analytics` ("You can specify multiple IDs by adding the same parameter multiple times") and `action_status` and `action_type` on `GET /ai-agents/sales/{id}/activities` are arrays sent as a repeated key. The native client writes a query value once, so the catalog declares them as one string value.
- **Limits of their own.** `POST /lead-labels/ai-reply-label`: "500 requests per 30 days per workspace". `POST /local-business-search/ai-filters`: "Up to 100 calls a day per workspace". `POST /local-business-search/search`: "a workspace may read 200 pages a day". Each is a lane. `POST /ai-agents/lead-finder/suggest-audience` is "Rate limited per workspace" with no number.
- **Lead list size.** The list object has no count. `GET /lead-lists/{id}/verification-stats` returns `total_leads` beside the verification counts, at one request per list, so `size` stays `null` and the read is native (`leadListVerificationStats`).
- **Not JSON.** `GET /block-lists-entries/download` answers with CSV text.
- No sister service on another host is documented: the specification has one server, `https://api.instantly.ai`.

## Sources

All fetched 2026-11-14. The file in `sources/` holding each download is given in parentheses.

- https://api.instantly.ai/openapi/api_v2.json (`api_v2.openapi.json`; primary source for every endpoint, parameter, field and enum)
- https://developer.instantly.ai/api-reference/openapi.json (`docs-site.openapi.json`)
- https://developer.instantly.ai/llms.txt (`llms.txt`)
- https://developer.instantly.ai/llms-full.txt (`llms-full.txt`)
- https://developer.instantly.ai/index.md (`index.md`)
- https://developer.instantly.ai/quickstart.md (`quickstart.md`)
- https://developer.instantly.ai/api-reference/introduction.md (`api-reference_introduction.md`)
- https://developer.instantly.ai/getting-started/getting-started.md (`getting-started_getting-started.md`)
- https://developer.instantly.ai/getting-started/authorization.md (`getting-started_authorization.md`)
- https://developer.instantly.ai/getting-started/rate-limit.md (`getting-started_rate-limit.md`)
- https://developer.instantly.ai/guides/webhook-events.md (`guides_webhook-events.md`)
- https://developer.instantly.ai/guides/workspace-group.md (`guides_workspace-group.md`)
- https://developer.instantly.ai/guides/api-v1-migration.md (`guides_api-v1-migration.md`)
- https://developer.instantly.ai/api-reference/campaign/list-campaign.md (`api-reference_campaign_list-campaign.md`)
- https://developer.instantly.ai/api-reference/email/list-email.md (`api-reference_email_list-email.md`)
- https://developer.instantly.ai/api-reference/lead/list-leads.md (`api-reference_lead_list-leads.md`)
- https://developer.instantly.ai/sdk/introduction.md, https://developer.instantly.ai/sdk/quickstart.md, https://developer.instantly.ai/mcp/introduction.md (`sdk_*.md`, `mcp_introduction.md`)
- https://developer.instantly.ai/sitemap.xml (`sitemap.xml`)
- https://developer.instantly.ai/changelog (404; no API changelog exists; not saved)
- https://help.instantly.ai/en/articles/6261906-webhooks (`help-webhooks.html`)
- https://help.instantly.ai/en/articles/10432807-api-v2 (`help-api-v2.html`)
- https://feedback.instantly.ai/changelog (`feedback-changelog.html`)
- Per-endpoint doc pages are linked from each entry's `source` in `endpoints.json`.
- Web search results (hookdeck.com, instantly.ai/blog) were used only as pointers; no claim above rests on them.

## Live run, 2026-11-14

The adapter was run read-only against one live Instantly workspace (more than 100 campaigns, more than 100 mailboxes) with an API V2 key. Nothing from the account is in this repository: the checks printed counts and field names only, and the fixtures are still built from the documentation. `npm run test:live` repeats the reads.

### What the documentation got wrong or left out

- **Steps count from 0.** `GET /campaigns/analytics/steps` reports a seven-step campaign as steps `"0"` to `"6"`. The adapter had read them as 1-based.
- **A step is an id of the form `sequence_step_variant`,** each counted from 0, for example `0_6_0`. It appears as `step` on an email and as `status_summary.lastStep.stepID` on a lead. The documentation types `step` only as a string.
- **Step analytics can hold rows with no step:** `step` is `null` or the text `\N`, with counts Instantly could not tie to a step.
- **`next_starting_after` is sent on a last page too.** A page of 11 tags came with one, and the page after it was empty. A page that is not full is the last one.
- **The email list does not hold every email a campaign sent.** A lead on its sixth step had one sent email and two replies. A received email carries the lead's address but no `lead_id`, and carries the step it replies to.
- **`i_status` on an email** took the values 0, 1, -1 and -2, matching the lead interest statuses. No email carried an automatic-reply flag.
- **A lead object** carried `email_open_count`, `email_reply_count`, `email_click_count`, `email_replied_step` (counted from 0) and `lt_interest_status`, and no `job_title`.
- **`GET /accounts/analytics/daily` without a mailbox** answers 413 on a workspace this size ("Add an emails filter or request a smaller date range").
- **`POST /leads/list` with `contacts: [address]`** returned exactly the lead with that address, in one request, and an address typed in capitals matched.

### Not exercised

The workspace had no subsequences and no campaign-scoped webhooks, and one whitelabel domain read answered 404 ("Domain not found"). Of 105 native reads, 34 take no required input and answered 200; the other 70 were not called.

### Load test

Hand-run once, from one process, with the default `share` of 0.5 (so 50 requests a second and 3,000 a minute against Instantly's documented 100 and 6,000):

| Fired at once | Result |
| --- | --- |
| 300 `campaigns.get` | all 300 succeeded; 1,505 HTTP requests (each read then cost 5, it now costs 3); no 429, no retry; 30 seconds |
| 14 `messages.list` on the lane limited to 20 a minute | all 14 succeeded; no 429; 60 seconds |

These are single observations, not a benchmark, and other tools on the same workspace may have been using the same limit at the time.

## Read again on 2026-11-14 for field coverage and the derived reads

Source: `https://api.instantly.ai/openapi/api_v2.json`, fetched fresh (198 paths, 268 operations). Nothing here was run against a live workspace.

- **Clicks.** `GET /campaigns/analytics/overview` and `GET /campaigns/analytics` have `link_click_count` ("The number of links that got clicked") and `link_click_count_unique` ("first click per lead"). The daily and step reports have `clicks` and `unique_clicks` ("Unique meaning from unique leads, not unique links"). Unique goes to `clicked`, the other to `clickedTotal`.
- **Every campaign's stats (`stats.allCampaigns`).** `GET /campaigns/analytics` with no `id`: "Leave this field empty to get the analytics for all campaigns". A bare array, one object per campaign, with `campaign_id`. Here `open_count` is "The number of leads that opened at least one email", so it is not read as a total of opens, and the response has no count of interested leads (`total_interested` is on the overview only), so `positive` is `null`. No per-day form exists for every campaign at once. The reference gives a schema and no example, so `fixtures/instantly/getCampaignsAnalytics.json` is built from the schema.
- **A sender's campaigns (`campaigns.bySender`).** `GET /account-campaign-mappings/{email}`: `{ items: [{ campaign_id, campaign_name, timestamp_created, status }], next_starting_after }`, with `limit` and `starting_after`. The status enum is the campaign's (`-99, -1, -2, 0, 1, 2, 3, 4`).
- **Unread (`replies.unread`).** `GET /emails` takes `is_unread` ("Whether the email is unread"), and each email carries `is_unread` (`null` or a number).
- **Sender fields.** `provider_code` enum: 1 Custom IMAP/SMTP, 2 Google, 3 Microsoft, 4 AWS, 8 AirMail, 11 Airmail Instant. `GET /accounts` takes `include_tags` and then returns `tags[] { id, label, description }` on each account.
- **Lead fields.** `phone`, `website` and `company_domain` are on the lead. No location and no LinkedIn field is documented.
- **A list's size.** `GET /lead-lists/{id}/verification-stats` returns `total_leads`. Not used: it is one request per list.
- **One list, one webhook (`lists.get`, `webhooks.get`).** `GET /lead-lists/{id}` returns the list item's fields and no count, so `lists.get` also reads `GET /lead-lists/{id}/verification-stats` for `total_leads`: two requests. This reverses the line above for a single list; a listing still has no size. `GET /webhooks/{id}` returns the list item's fields, `headers` included, which the mapper drops.
- **Campaign progress (`campaigns.progress`).** `GET /campaigns/analytics?id=` returns one row with `leads_count` ("The total number of leads") and `completed_count` ("The number of leads that the campaign was completed for"). Nothing splits the leads still waiting, in progress or stopped.
- **Placement tests (`placementTests.list`).** `GET /inbox-placement-tests`: `{ items, next_starting_after }`. Item fields used: `id`, `name`, `status` (1 Active, 2 Paused, 3 Completed), `type` ("Whether the inbox placement test is a one-time test or an automated test", enum 1 and 2 with no names: read as 1 one-time, 2 automated, in the order of the sentence), `campaign_id`, `timestamp_created`, `timestamp_next_run`. Results (`/inbox-placement-analytics`) are one row per test email and stay native.

## Response shapes for list endpoints (2026-11-15, for OUT-73)

Fetched fresh on 2026-11-15 to decide which 200 bodies a list read may accept:

- https://api.instantly.ai/openapi/api_v2.json (`info.version` 2.0.0, 198 paths). The 200 schema of each endpoint below was read directly.
- https://developer.instantly.ai/api-reference/campaign/list-campaign.md (the page agrees with the spec: `items` is in `required`).

Every paged list has one schema: `{ items: array (required, not nullable), next_starting_after?: string }`. No list endpoint the adapter reads is documented as a bare array, and none documents `items` as optional or `null`. An empty list is `{ "items": [] }`, with or without `next_starting_after`. The analytics reports are the opposite: a bare array of rows, never wrapped.

| Endpoint | Read by | Documented 200 body | List field | Paging |
| --- | --- | --- | --- | --- |
| `GET /campaigns` | `campaigns.list` | object | `items` (required array) | `limit`, `starting_after` in; `next_starting_after` out (optional string) |
| `GET /account-campaign-mappings/{email}` | `campaigns.list({ senderId })` | object | `items` | same |
| `GET /custom-tag-mappings` | campaign and sender tags (lookup) | object | `items` | same |
| `GET /custom-tags` | tags lookup, `tags.list` | object | `items` | same |
| `GET /accounts` | `senders.list`, `senders.byCampaign` | object | `items` | same |
| `POST /leads/list` | `leads.list`, `leads.lookup` | object | `items` | `limit`, `starting_after` in the body; `next_starting_after` out |
| `GET /emails` | `messages.list`, `replies.list` | object | `items` | same; own lane of 20 a minute |
| `GET /lead-labels` | custom interest labels (lookup) | object | `items` | same |
| `GET /block-lists-entries` | `blocklist` | object | `items` | same |
| `GET /lead-lists` | `lists.list` | object | `items` | same |
| `GET /inbox-placement-tests` | `placementTests.list` | object | `items` | same |
| `GET /subsequences` | `sequence.subsequences` | object | `items` | same |
| `GET /webhooks` | `webhooks.list` | object | `items` | same |
| `GET /campaigns/analytics` | `stats` (every campaign), `campaigns.progress` | bare array | the body | none |
| `GET /campaigns/analytics/steps` | `stats` by step | bare array | the body | none |
| `GET /campaigns/analytics/daily` | `stats` by day | bare array | the body | none |
| `GET /accounts/analytics/daily` | `stats` for a sender | bare array | the body | none |

Ambiguous or not documented:

- Nothing in the spec says whether a page past the end returns `{ items: [] }` or omits `items`. The schema requires it, so an absent `items` is treated as a broken answer.
- `next_starting_after` is typed `string` and is not marked nullable. The live run of 2026-11-14 found it sent on a last page too. Reading a `null` as "no next page" stays lenient.
- `fixtures/instantly/` matches the spec: every `list*.json` is `{ items, next_starting_after? }`, and the four analytics fixtures are bare arrays.
