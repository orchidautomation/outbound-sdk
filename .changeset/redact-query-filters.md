---
"outbound-sdk": patch
---

The redact plugin now puts the real value back for every token in a call's query, not only in its id, so a filter like a lead timeline's `leadId` no longer reaches the vendor as `redacted:…`. This fixes `dropped_replies` with redaction on over a combined instance. `dropped_replies` also counts a conversation whose read fails in `totals.unchecked`, with a note, instead of failing the whole report; a request cap still stops the run.
