---
"outbound-sdk": minor
---

`sync.run` says what of the inbox any run leaves out, names each checkpoint's campaign, and takes a scope found once (OUT-207, OUT-208, OUT-209).

- Every `SyncResult` has `inboxLeftOut`. An unscoped sync of `replies` on a tool whose inbox holds replies tied to no campaign, such as HeyReach, reads them as `replies.list` does, without `includeInbox`, so it now notes that they were left out and gives `inboxLeftOut: null`, an unknown count, as a scoped run already did. A run with `campaignId` says the same of replies and messages. An unscoped `messages` sync reads the inbox's conversations, so it leaves out `0`. `scope.inboxLeftOut` keeps the same value.
- A checkpoint of one campaign carries `campaignRef`, the campaign's ref (`provider:workspace:id`, a bare `campaignId` qualified), and `onPage` gets a second argument, `{ campaignRef }`, so a caller can keep one sync row per campaign. Keys are unchanged.
- `sync.run(collection, { resolved: await resolveScope(outbound, scope), onPage })` syncs those campaigns without finding them again, so syncing several collections of one scope lists its campaigns once. Its `requests` leave out what finding them cost. A `resolved` of another provider or workspace, or one given with `campaignId` or a scope, is `Invalid` before any request. `SyncPage` is exported from `outbound-sdk/sync`.
