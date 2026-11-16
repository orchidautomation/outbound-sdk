---
"outbound-sdk": minor
---

Say that a reply is a message, not a person (OUT-88). `outbound replies` writes a line to standard error such as "40 messages from 21 people in 9 threads."; standard output is the same JSON. `outbound replies --by person` prints one row per `leadRef` with `messages`, `firstAt`, `lastAt`, `categories` and `threadIds`. The `reply_samples` tool's description says each record is one message, its result adds `unique_people` and `unique_threads`, and a new optional `by: "person"` input returns `people` rows in place of `replies`. Both counts are `null` when a reply has no lead or thread.

`MetricRow` gains two optional counts, `repliedTotal` and `repliedAutoTotal`: reply messages, every reply counted, beside the people counted in `replied` and `repliedAuto`. Instantly fills them from `reply_count` and `reply_count_automatic` (by day and step `replies` and `replies_automatic`), so its dashboard's "Replies" is `repliedTotal + repliedAutoTotal`. Every other adapter returns `null`. `schemaVersion` stays 1.
