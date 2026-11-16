---
"outbound-sdk": patch
---

`hot_leads` no longer drops recently replied leads silently under the redact plugin, the default for `outbound mcp`. A reply can name its lead by email address (Instantly's do), and redact masks addresses, so the search for replied leads past `max_leads` found nothing, and under a hashing redact it asked the vendor for a lead by its hashed token. It now skips that search, and under the default `mask` strategy the check that tells automatic replies from people, and says so in `meta.notes` with `complete: false` (OUT-111).
