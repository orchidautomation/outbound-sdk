---
"outbound-sdk": minor
---

A scoped `sync.run` says what of the inbox it left out (OUT-203). HeyReach inbox conversations tied to no campaign cannot be matched to a campaign scope, because a conversation does not name its campaign (checked against HeyReach's docs and live on 2026-11-23). A scoped sync of `replies` or `messages` on a tool with such an inbox now notes that they were left out, and `scope.inboxLeftOut` is `null`, an unknown count; it is `0` where the tool has no inbox or the collection has none.
