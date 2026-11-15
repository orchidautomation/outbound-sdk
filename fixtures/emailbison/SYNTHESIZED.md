# Fixture provenance (EmailBison)

Built on 2026-11-15 from the API reference's examples (`https://dedi.emailbison.com/api/reference.openapi`) and from `https://emailbison.com/developers`. No fixture comes from a live API call: no EmailBison account was available. Field names and value shapes are copied from the examples.

## Changed in every file

- **Repaired to valid JSON.** Many examples are hand-written strings that do not parse: unquoted values (`"sequence_prioritization": new_leads`), missing or trailing commas, an unclosed string, and `GET /api/workspaces/v1.1`, whose example wraps bare key-value lists in an object.
- **Personal data replaced** with fakes: `personN@example.com`, `senderN@example.com`, "Alex Example", "Sam Sender", "Example Co", `example.com` hosts. The examples' real-looking companies and addresses were removed.
- **Counts made distinct.** The examples repeat one number across fields (`"5"` for every summary count, `0` for every warmup count), so each count was given its own value to tell the fields apart in tests.
- **`links` and `meta`** use the reference's documented shapes: `current_page` and `last_page` for lists read by page number, `next_cursor` and `prev_cursor` for lists read by cursor (from the pagination page). The examples' placeholder hosts (`http://bison.test`) became `https://dedi.emailbison.com`.

## Built beyond the examples

| File | What was synthesized |
| --- | --- |
| `*.page2.json` | The last page of each list. Every example is a single page. |
| `listCampaigns.json`, `listCampaigns.page2.json` | A third campaign (`Paused`) was added to test status mapping. |
| `listSenders*.json` | A Microsoft sender with `Not connected`, and a first address in mixed case. |
| `listLeads*.json`, `getLead.json` | Three leads, one each verified, bounced and unsubscribed. Custom variables hold a website and an `example-person-1` LinkedIn URL. |
| `listCampaignLeads*.json` | `lead_campaign_data.status` is `in_sequence` on one lead (a filter value; the only documented record value is `stopped`) and `stopped` on the other. |
| `getSequenceSteps.json` | Three steps: step 1, step 2, and a variant of step 2 with `variant_from_step_id: null`, as the example's variant has. |
| `getCampaignStats.json` | Totals from the workspace summary's shape plus `sequence_step_stats` for the three step ids of `getSequenceSteps.json`. |
| `getWorkspaceDailyStats.json`, `getCampaignDailyStats.json`, `getCampaignEventStats.json` | The documented seven series, over two or three days, with a different count per series and day. |
| `listLeadSentEmails.json` | One sent and one still-scheduled email, from the example's two items. |
| `listReplies*.json`, `listLeadReplies.json`, `getConversationThread.json` | Built from the reply example: an interested reply, an automated reply, a plain one, and outgoing messages (`folder: "Sent"`, `type: "Outgoing Email"`, as in the events example). |
| `listWorkspaces.json` | Two records of the workspace detail example. `webhooks_secret_key` holds a placeholder, not a secret. |
| `listBlacklisted*.json` | Mixed-case values, to test lowercasing. |
| `listWebhooks*.json` | A third webhook and an event name EmailBison does not document (`something_new`). |
| `webhook.EMAIL_SENT.json` | The sample-payload example's inner object, with an `instance_url` added as other payloads carry it. |
| `webhook.MANUAL_EMAIL_SENT.json` | The `payload` of the `GET /api/events` example. |
| `webhook.TAG_ATTACHED.json` | The sample on `https://emailbison.com/developers`. |
| `webhook.LEAD_REPLIED.json`, `webhook.LEAD_INTERESTED.json`, `webhook.UNTRACKED_REPLY_RECEIVED.json`, `webhook.EMAIL_BOUNCED.json`, `webhook.EMAIL_ACCOUNT_DISCONNECTED.json` | **No documented payload.** Built from the documented `data` keys (`reply`, `campaign_event`, `lead`, `campaign`, `scheduled_email`, `sender_email`). |
| `error.401.json`, `error.422.json`, `error.429.json` | The error bodies on `https://emailbison.com/developers`. |
