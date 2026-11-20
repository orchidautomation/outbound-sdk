---
"outbound-sdk": minor
---

Say "unknown" instead of a false 0 for unanswered replies, and join one person's email and LinkedIn replies (OUT-178).

- `droppedReplies` (MCP `unanswered_replies`, old name `dropped_replies`): `totals.dropped` is now `null` while any conversation went unchecked or more replies were left unread, and the new `totals.droppedFound` counts the dropped conversations found, a lower bound. A new `finding` sentence leads with what went unchecked. This follows `suppression_check` and `lead_collisions`. Code that read `totals.dropped` as a number must handle `null`.
- `reply_samples` with `by: "person"`, on an instance reading two or more tools, reads the listed people's leads (one request per lead, or per page of leads) and joins rows that share an email address or LinkedIn profile, so a person who replied by email in one tool and on LinkedIn in another is one row. Rows carry `linkedinUrl`, `leads` and `tools`; the answer adds `linkedBy` (the identifier types leads of two or more tools carry) and `linkedAcrossTools`, and a note says what joined them or that nothing could. Under redact a profile gets one token in both tools, so the masked rows still join. One tool's answer reads no lead and is unchanged apart from the new fields.
