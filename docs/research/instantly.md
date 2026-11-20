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

Sender variables (fetched 2026-11-16 from https://help.instantly.ai/en/articles/9178224-how-to-add-a-signature and https://help.instantly.ai/en/articles/7902437-ways-to-add-a-signature): Instantly fills `{{accountSignature}}` (the sending account's signature), `{{sendingAccountName}}` (its sender name), `{{sendingAccountFirstName}}` and `{{sendingAccountEmail}}` from the sending account at send time. They are not lead fields, so `personalization_gaps` lists them with source `sender` (`src/insights/variables.ts`).

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

### Messages sent by hand (`messages.byHand`, OUT-115)

Fetched 2026-11-16 from `https://api.instantly.ai/openapi/api_v2.json` (`info.version` 2.0.0, `GET /api/v2/emails`) and `https://developer.instantly.ai/api-reference/email/list-email.md`. **Docs-verified, not live-verified.**

- `email_type` takes `received`, `sent` or `manual`, described only as "The type of the email to filter by."
- The email's `ue_type` is "Email type based on the life cycle of the email": `1` Sent from campaign, `2` Received, `3` Sent, `4` Scheduled.
- The adapter sends `email_type=manual` with `min_timestamp_created` for a window, and keeps only emails whose `ue_type` is `3`, so a campaign send never counts as sent by hand even if `manual` turns out to mean something wider.

## Campaign page size and the workspace label (2026-11-18, for OUT-169)

## The emails lane and conversation checks, 2026-11-20 (OUT-179)

Fetched 2026-11-20: the OpenAPI spec at `https://api.instantly.ai/openapi/api_v2.json` (`info.version` 2.0.0), operation `GET /api/v2/emails` (reference page `https://developer.instantly.ai/api-reference/email/list-email`). What it says, unchanged from section 5 except where noted:

- "**Rate Limit:** This endpoint has a rate limit of 20 requests per minute, unlike other API endpoints." No rate-limit or Retry-After header is documented for it.
- `latest_of_thread` (boolean): "Whether to only return the latest email in each thread." Section 5 lists the name; this is its whole description.
- `email_type` is `received`, `sent` or `manual`; `min_timestamp_created` and `max_timestamp_created` take ISO timestamps; `search` takes `thread:<id>`; `limit` is 1 to 100.

Seen live the same day, read-only, on one workspace (counts only):

| Query, 14 days | Rows | Pages | What the rows are |
| --- | --- | --- | --- |
| `email_type=received` | 148 to 149 | 3 (100, 48, then 0) | every reply, in 137 threads |
| `latest_of_thread=true` | 600+ | 6+ | one per thread a campaign sent in; 596 of the first 600 a campaign send |
| `email_type=received&latest_of_thread=true` | 141 to 142 | 2 full, then 0 | one per thread holding a reply (all 137), whoever sent last: 30 campaign sends (`ue_type` 1), 13 sent by hand (3), 99 replies (2) |

So with `email_type=received`, `latest_of_thread` selects the threads that hold a received email and answers each one's latest email in either direction. A full read of 7 of those threads (`search=thread:<id>`; 4 ending in a send, 3 in a reply) gave the same latest email every time. No row was scheduled (`ue_type` 4). The adapter maps it to `messages.listAll({ latestOfConversation: true })`, so `dropped_replies` settles every answered conversation from one listing instead of one read each.

Every `/emails` listing, a thread read included, sends `next_starting_after` on its last page and answers an empty page after it. The latest listing and thread reads stop at a page that is not full, so a conversation read costs one request instead of two.

The lane in practice, measured from one process with nothing else on the Mac reading (another reader of the same workspace elsewhere cannot be ruled out):

- A burst of 25 requests at one a second after 70 s of quiet: 11 answered 200, then 14 answered 429.
- One request per 6.2 s (9.7 a minute) after 75 s of quiet: 18 of 20 answered 200; the 9th and the 19th answered 429.
- No 429 carried a rate-limit or Retry-After header.

So about 10 reads a minute get through, half the documented 20. The adapter's default share of 0.5 keeps to 10 a minute, and a 429 halves that. Within the MCP server's 50 s time budget a call has about ten emails-lane reads.

Where they went before this change (main at dc90cb1, `unanswered_replies` over `--provider all`, logged by path and page size only): the first page of replies, then the second page of 48 read again 7 times, and the call stopped at 34 requests and 6 to 9 s with `unchecked: 18` of 18. The combined listing gives replies newest first across tools; HeyReach's inbox pages held 0 to 4 replies each, so Instantly's waiting page was read again for every HeyReach page. A combined walk now holds a page it must read again for the rest of that call (`ctx.remember`), so that listing costs 3 lane requests.
