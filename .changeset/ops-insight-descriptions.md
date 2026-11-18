---
"outbound-sdk": patch
---

Shorter descriptions for the ops insights (OUT-168). `client_report`, `period_comparison`, `campaign_diagnosis`, `campaign_ranking`, `channel_mix`, `tag_rollup`, `anomalies` and `pipeline_forecast` each describe themselves in under 600 characters. The caveats they dropped are said in the answer where they apply: `period_comparison` and `client_report` add a note when a reply rate falls back to leads contacted, and `channel_mix` and `tag_rollup` add one when every reply rate divides by messages sent.
