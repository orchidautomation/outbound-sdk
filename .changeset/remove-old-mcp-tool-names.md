---
"outbound-sdk": minor
---

**Breaking for MCP clients and `outbound tool`: the tool names that 0.16.0 merged no longer answer (OUT-198).** 0.18.0 said they would answer until 0.19.0.

- A `tools/call` or `outbound tool` with an old name is now an unknown tool. Call the listed tool instead: `campaign_overview`, `campaign_ranking` and `campaign_trend` are `campaigns` with `view` `list`, `ranking` or `trend`; `deliverability_check`, `warmup_readiness`, `domain_health` and `bounce_watch` are `sender_health` with `checks` `deliverability`, `warmup`, `domains` or `bounces`; `sender_load` is `sender_capacity` with view `load`; `pipeline_forecast` is `lead_runway` with view `forecast`; `suppression_check` and `lead_collisions` are `list_hygiene` with checks `suppression` or `collisions`; `copy_audit`, `variant_test`, `personalization_gaps` and `copy_reuse` are `copy_review` with checks `audit`, `variants`, `personalization` or `reuse`; `winning_steps` is `step_funnel` with view `winners`; `person_summary`, `cross_channel_lead` and `account_summary` are `person` with view `summary`, `timeline` or `account`; `dropped_replies` is `unanswered_replies`.
- `RENAMED_TOOLS` is no longer exported from `outbound-sdk/cli`. `initialize` now says, once, which listed tool answers each of those names (such as `bounce_watch is sender_health with checks ["bounces"]`), so an agent that knows a CLI insight name is not stuck, but a call by that name is refused.
- `--tools` still takes one of those names, to offer the listed tool with only that view or check. The SDK's own tools (`createTools`), the insights and `outbound insight` keep their names.
