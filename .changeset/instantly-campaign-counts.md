---
"outbound-sdk": minor
---

`MetricRow` gains four optional counts: `leads`, `completed`, `opportunities` and `opportunityValue` (OUT-90). Instantly fills them from its campaign analytics: every-campaign rows (`stats({ scope: "campaign" })`) carry all four, and one campaign's or the workspace's total carries `completed`, `opportunities` and `opportunityValue` (the overview has no lead count, so `leads` is `null` there). Every other adapter returns `null`. `schemaVersion` stays 1, and a row built without the new keys is still valid.

`campaign_diagnosis` adds the `contacted_exceeds_leads` finding: leads contacted more than twice the campaign's leads, which means the contacted count is not unique leads. It reads the campaign's progress for the lead count where the adapter serves it, so it costs up to 8 requests instead of 7. Instantly, Smartlead and HeyReach declare that read as one request.
