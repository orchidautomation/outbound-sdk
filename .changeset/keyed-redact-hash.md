---
"outbound-sdk": minor
---

`redact()` reads its key from `OUTBOUND_REDACT_KEY` when you pass no `key`, as the CLI and `outbound mcp` already did, so one key gives the same token for the same person in your code, the CLI and the MCP server. A `key` you pass still wins, and a key shorter than 32 characters from the variable is refused with `Invalid` naming the variable, never the key. A `redact()` in a CLI config file now reads the variable too, so the CLI no longer warns that it is ignored. (OUT-150)

`strategy: "hash"` now takes the key and writes an HMAC-SHA-256 under it, so a hashed token can no longer be computed from a guessed address. **If you hash with `OUTBOUND_REDACT_KEY` set, every hashed token changes:** re-load a store built from the old tokens once. `hash` with no key still works as before but is deprecated: it warns once per process on stderr, and every answer that holds a token carries a note in `meta.notes`. A `mask` redact with no key notes on such answers that its tokens hold only within this instance or process. `REDACT_KEY_ENV` is exported from `outbound-sdk/redact`. (OUT-150)
