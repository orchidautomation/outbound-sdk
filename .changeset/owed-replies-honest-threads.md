---
"outbound-sdk": minor
---

`droppedReplies` counts only conversations a person owes, automatic replies are counted apart wherever a category is counted, and `threadContext` says when it could not read something (OUT-146, OUT-151), and `droppedReplies` keeps what it read at a request cap (OUT-156).

- `droppedReplies` no longer lists a conversation whose latest message, once read in full, is an automatic reply. A reply listing cannot time a reply against the send it answers, so an Instantly reply that arrived within a minute of the send used to pass as human and be counted as dropped. Its replies now count in `totals.skippedAuto`, with a note, and `totals.conversations` leaves it out. `include_auto: true` still lists it.
- `droppedReplies` at a request cap (`maxRequests`, `--max-requests`) returns what it read with `meta.complete: false` and a note, instead of throwing `RateLimited`. The conversations the cap stopped count in `totals.unchecked`, never as answered or dropped.
- `reply_samples` and `outbound replies` count the replies flagged automatic in a new `automatic` field, on the totals and on each `--by person` row (`null` when a reply's `isAuto` is unknown), and the CLI note says how many of the messages are automatic. A vendor can label an automatic reply positive.
- `threadContext` sets `meta.complete: false`, with a note, whenever a conversation or a lead could not be read. It used to say `complete: true` with every conversation in `coverage.unchecked`.
- `threadContext` refuses a redacted ref its redact plugin did not write, such as one from an earlier MCP server or CLI run, with `NotFound` before any request and a message saying to run the tool that returned it again in the same session. The token used to reach the vendor as the lead id and come back as `the read failed with Invalid`.
- Under redact, `threadContext`'s `bodies` defaults to `none` instead of refusing its own default. Asking for `snippet` is still `Unsupported`.
