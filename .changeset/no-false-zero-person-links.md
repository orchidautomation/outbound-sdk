---
"outbound-sdk": minor
---

Say "unknown" instead of a false 0 for unanswered replies, and join one person's email and LinkedIn replies (OUT-178).

- `droppedReplies` (MCP `unanswered_replies`, old name `dropped_replies`): `totals.dropped` is now `null` while any conversation went unchecked or more replies were left unread, and the new `totals.droppedFound` counts the dropped conversations found, a lower bound. A new `finding` sentence leads with what went unchecked. This follows `suppression_check` and `lead_collisions`. Code that read `totals.dropped` as a number must handle `null`.
- `reply_samples` with `by: "person"` reads the listed people's leads (one request per lead, or per page of leads), so each row carries `linkedinUrl` as well as `leadEmail`, with `leads` and `tools`. On an instance reading two or more tools, rows that share an email address or LinkedIn profile are joined, so a person who replied by email in one tool and on LinkedIn in another is one row; the answer adds `linkedBy` (the identifier types two or more tools carry, from the leads read and what each vendor fills) and `linkedAcrossTools`, and a note says what joined them or that nothing could. Under redact a profile gets one token in both tools, so masked rows still join. The CLI's `replies --by person` is unchanged.
