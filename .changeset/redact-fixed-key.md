---
"outbound-sdk": minor
---

`redact({ key })` takes an optional secret, at least 32 characters, that keys the tokens `mask` writes for email addresses and LinkedIn profiles. With it, the same person gets the same token in every instance and process given the same key, so redacted data joins across runs. The CLI and `outbound mcp` read the key from `OUTBOUND_REDACT_KEY`. A shorter key, or a key given with `strategy: "hash"`, is refused with `Invalid` when the plugin is built. The key is never put in a record, an answer or an error. With no key, nothing changes: each plugin makes a random key of its own. `MIN_KEY_LENGTH` is exported from `outbound-sdk/redact`.
