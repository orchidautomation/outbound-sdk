---
"outbound-sdk": patch
---

The sync docs now state what SendLens and other callers can rely on (OUT-213, OUT-214).

- `campaign_name: "*"` is the supported way to mean every campaign, in `sync.run` and `resolveScope`.
- A scoped or `resolved` sync syncs campaigns in the order of `resolved.campaigns`, so a caller can reorder them, such as active campaigns first.
- `sync.run` accepts a `resolved` when its `campaigns` is an array and `meta.provider` and `meta.workspaceId` are the instance's. Nothing else is checked. This is unchanged and now pinned by tests.
- The npm package now includes CHANGELOG.md.
