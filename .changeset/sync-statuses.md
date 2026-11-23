---
"outbound-sdk": minor
---

`sync.run` and `resolveScope` take `statuses`, which narrows a campaign scope to campaigns in those statuses (OUT-211).

- `sync.run("leads", { statuses: ["active"], onPage })`, then a run of the other statuses, back-fills active campaigns first and reads no campaign twice. Each campaign keeps the same ref-keyed checkpoint as any scoped run.
- It works alone or with `campaign_ids`, `tag` and `campaign_name`, and is matched here over the campaign listing. An empty list, an unknown status, or `statuses` with `campaignId` or `resolved` is `Invalid` before any request. `ResolveScopeInput` is exported.
