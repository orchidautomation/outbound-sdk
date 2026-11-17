# Which tool answers which question

Each row is a question an operator asks and the tool that answers it. Call a tool only if it is in your tool list: the list holds only what this adapter and its plugins can serve. Each tool's own description and input schema, which your client shows you, are the authority on its inputs.

The test suite checks this page against the SDK. Every tool and insight appears once, and every name here exists.

## Campaigns

| Question | Tool |
| --- | --- |
| How are my campaigns doing? | `campaign_overview` |
| How did replies (or sends, bounces) move day by day? | `campaign_trend` |
| Which step or variant gets the replies? | `winning_steps` |
| Is the A/B leader ahead by more than chance? | `variant_test` |
| Where in the sequence do replies come from? | `step_funnel` |
| Why is this campaign underperforming? | `campaign_diagnosis` |
| Which campaigns are best, fairly ranked at different volumes? | `campaign_ranking` |
| How did this period compare with the one before? | `period_comparison` |
| Which days broke from the trend? | `anomalies` |
| How is email doing against LinkedIn? | `channel_mix` |
| How do results add up by campaign tag? | `tag_rollup` |
| How is this campaign set up to send (windows, caps, tracking, stop rules)? | `campaign_setup` |
| Which campaign settings are risky? | `settings_audit` |
| When does this campaign run out of leads? An estimate. | `lead_runway` |
| How many leads and days are left, and what replies to expect? | `pipeline_forecast` |
| A report for one client or workspace, with action items | `client_report` |
| The same counts for every client, side by side (needs the `clients` plugin) | `compare_clients` |

## Senders and deliverability

| Question | Tool |
| --- | --- |
| Which senders are paused, disconnected or in error? | `sender_health` |
| Are DNS, sign-in and warmup in order for each sender? | `deliverability_check` |
| How is each sending domain doing? | `domain_health` |
| Which campaigns or senders are bouncing too much? | `bounce_watch` |
| Which senders are not ready to send yet? | `warmup_readiness` |
| Can my senders send what my campaigns ask of them? | `sender_capacity` |
| Which senders are on too many campaigns, and which sit idle? | `sender_load` |

## Replies, leads and people

| Question | Tool |
| --- | --- |
| Show me recent replies, or only the positive ones | `reply_samples` |
| Which replies has nobody answered? | `dropped_replies` |
| How fast do people reply, and on which days and hours? | `reply_timing` |
| Who should I call first? | `hot_leads` |
| What has happened with this one person? Takes an email, a profile or a lead ref (not offered while `redact` masks both emails and LinkedIn) | `person_summary` |
| Every record and message for one person, across tools (needs the `identity` plugin, which the CLI and `outbound mcp` always add; not offered while `redact` masks emails or LinkedIn) | `cross_channel_lead` |
| Who at this company have we contacted? (not offered while `redact` masks emails) | `account_summary` |
| Who is in two campaigns at once? | `lead_collisions` |
| Is anyone on the block list still in a campaign? (domain entries go unmatched while `redact` masks emails, as `outbound mcp` does) | `suppression_check` |
| Which leads will get broken copy from an empty merge variable? | `personalization_gaps` |
| What lead lists exist, and how big are they? | `audience_lists` |

## Copy

| Question | Tool |
| --- | --- |
| What is wrong with this copy: length, links, spam words, variables? | `copy_audit` |
| What does this templated copy look like for a real lead? | `copy_preview` |
| How does the same copy do in different campaigns? | `copy_reuse` |

## Anything else

| Question                                               | Tool          |
| ------------------------------------------------------ | ------------- |
| Something the vendor reports that no tool above covers | `vendor_read` |

`vendor_read` with no `name` lists the vendor's own reads and makes no request. With a `name` it runs one and returns the vendor's response as the vendor sent it: not normalized, not masked, and wrapped as untrusted content. It is not offered on the in-memory adapter, or when the `redact` plugin is on.
