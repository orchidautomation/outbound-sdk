---
"outbound-sdk": minor
---

**Breaking:** an Instantly message's or reply's `leadRef` is now the lead's own ref, the one `leads.list` returns, so replies join to leads by ref; the address moves to a new `leadEmail` field (OUT-149). A redacted token from another session or process is refused on every read, before any request (OUT-151).

- An Instantly email names its lead by address only, so each page of emails now looks up its leads' ids with one `POST /leads/list` per 100 addresses, on the default lane, matched by the email's campaign. A page of replies or messages costs one more request than before. A lead's timeline needs no lookup, and reads the lead's own campaign.
- A lead is one per campaign, so one person in two campaigns now has two `leadRef`s. `reply_samples` and `outbound replies` count and group people by `leadEmail` where it is present, and their records carry `lead_email` / `leadEmail`.
- `leadRef` is `null` when no lead has the address, for example a deleted lead. `leadEmail` still names the person.
- Migration: code that joined an Instantly reply to a lead on `lead.email` can join `reply.leadRef` to `lead.ref`; code that read the address out of `leadRef` reads `leadEmail`. Stored address-shaped refs still work in `outbound.lead(ref)`, `leads.get`, `person_summary` and `thread_context`. The other adapters leave `leadEmail` out and their `leadRef` is unchanged.
- Under redact, `leadEmail` is masked like `email`. A call that names a token the plugin did not write, such as one kept from an earlier CLI command or MCP session, is refused as `NotFound` before any request, so it never reaches the vendor; the message says it is from another session or process and that redact's `key` (or `OUTBOUND_REDACT_KEY`) keeps tokens the same across runs.
