---
"outbound-sdk": minor
---

`sync.run` takes the campaign scope, and `resolveScope` is public (OUT-202).

- `outbound.sync.run(collection, { tag | campaign_name | campaign_ids, onPage })` syncs only the scope's campaigns, found before any per-campaign read as every insight finds them. Each campaign keeps its own checkpoint, keyed by its ref, and `maxPages` counts pages across them. The result's `scope` says how the campaigns were found and what each synced. Senders shared by several campaigns are handed out once per run.
- `resolveScope(outbound, scope)` from `outbound-sdk` returns the campaigns a scope covers, with `meta.tools` saying for each tool whether they were read by id, filtered by the vendor, or matched here.
- A tag where campaigns carry no tags is `Unsupported`, and a malformed scope, an empty one for `resolveScope`, or a scope with `campaignId` `Invalid`, before any request.
- `CampaignScopeInput`, `ResolvedScope`, `ResolvedScopeMeta`, `ScopeTool`, `ScopeFilter`, `SyncScopeResult` and `SyncCampaignResult` are exported.
