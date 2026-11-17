---
"outbound-sdk": minor
---

Several senders' stats in one read (OUT-143). `outbound.stats({ scope: "sender", scopeIds })` returns a row for each sender (and each day with `by: "day"`). Each row's `scopeRef` says which sender it belongs to, and a sender the vendor has no rows for gets none. The new `stats.bySenders` capability gates it. Instantly supports it: one `GET /accounts/analytics/daily` reads up to 200 mailboxes, and the workspace's tracking settings are read once for all of them instead of once per mailbox. Other adapters refuse it with `Unsupported` before any request.

`sender_health` and `deliverability_check` use it to read every failing sender's recent sends at once. On Instantly a failing mailbox now costs only the listing of its campaigns, so impact covers up to 200 failing senders (the cap was 10). Adapters without it still read one sender at a time and keep the cap of 10.
