---
"outbound-sdk": minor
---

Type change: `LeadStatus` and `LeadProgress` gain `"skipped"` (approved by Brandon 2026-11-16); code that switches exhaustively on them must handle it. Instantly lead status `-3` (Skipped, a lead the vendor decided not to send to) now maps to `skipped` instead of `unknown` (OUT-100). `pipeline_forecast.byStatus` gains a `skipped` count, and `pipeline_forecast` and `lead_runway` do not count a skipped lead as left to start or as of unknown status.

`Lead` gains an optional `recipientMailProvider` (`"google"`, `"microsoft"`, `"other"` or `null`), read from Instantly's `esp_code`; every other adapter returns `null`. A lead built or stored without the key is still valid.

`person_summary`: when the vendor's status is `replied` only because of automatic replies, `leadStatus` is where the lead is in the sequence instead, so it agrees with `replied`. The new `vendorLeadStatus` keeps the vendor's status as it came.
