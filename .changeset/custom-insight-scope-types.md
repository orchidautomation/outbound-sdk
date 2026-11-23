---
"outbound-sdk": patch
---

A custom insight's input type takes the campaign scope (OUT-204). `defineInsight` already added `campaign_ids`, `tag` and `campaign_name` to the schema at run time, but not to the type, so `runInsight(outbound, definition, { tag: "client-a" })` failed with TS2345 for an input schema of `z.object({})`. It type-checks now, and a scope key of the wrong type is still refused. The scope's keys are exported as `CampaignScopeInput`.
