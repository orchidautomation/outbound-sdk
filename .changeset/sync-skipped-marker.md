---
"outbound-sdk": patch
---

A scoped `sync.run` that skips a campaign the tool lists but cannot open now marks it: the entry in `scope.campaigns` has `complete: false` and `skipped: { reason: "cannot-open" }`, and `scope.skipped` lists the skipped refs. Before, the entry read `complete: true` with 0 records and only the note named it. The run's `complete` still leaves skipped campaigns out, so a loop that runs until `complete` ends.
