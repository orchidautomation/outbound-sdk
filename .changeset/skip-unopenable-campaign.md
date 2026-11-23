---
"outbound-sdk": patch
---

A scoped `sync.run` skips a campaign the tool lists but cannot open, instead of failing the whole run. On HeyReach, a listed draft whose conversations answer 400 "The campaign you are trying to open does not exist." is skipped with a note naming its ref, keeps no checkpoint, and the other campaigns sync. Any other error still fails the run. Reading that campaign's replies or messages directly (`replies.list({ campaignId })`) now throws `NotFound` instead of `Invalid` (OUT-221).
