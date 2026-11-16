---
"outbound-sdk": patch
---

`hot_leads` no longer drops recently replied leads silently under the redact plugin, the default for `outbound mcp`. A reply can name its lead by email address (Instantly's do), and a masked or hashed address cannot be looked up at the vendor, so the search for replied leads past `max_leads` found nothing. It now skips that search and says so in `meta.notes` with `complete: false` (OUT-111).
