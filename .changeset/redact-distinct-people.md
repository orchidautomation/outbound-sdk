---
"outbound-sdk": minor
---

`redact()` no longer merges everyone into one person. Under the default `mask` strategy an email address or a LinkedIn profile inside a `ref`, a `sourceId`, a `*Ref` field or a person key used to become one shared `[redacted]`, so on HeyReach, whose lead id is the profile URL, `outbound leads --redact` gave 1 lead of 306, `replies --by person` 1 person of 115 and `hot_leads` none; on Instantly every reply named the same lead. It is now `redacted:` and 16 hex characters of an HMAC-SHA-256 under a random key each `redact()` makes and never gives out, so the people counts match the unmasked ones, and no address or profile shows.

The `email`, `address` and `linkedinUrl` fields, a blocked address or profile, and a webhook event's `leadEmail` and `linkedinUrl` get the same token under `mask` instead of `[redacted]`, so a reply still joins its lead. A token holds while the plugin lives (one CLI command, one `outbound mcp` session) and differs in the next. Names, companies, phones, custom fields and text are still `[redacted]`, and `strategy: "hash"` is unchanged.
