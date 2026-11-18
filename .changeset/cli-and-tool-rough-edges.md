---
"outbound-sdk": minor
---

Polish CLI and tool rough edges from the 0.12.0 user tests (OUT-169).

- **`reply_samples` with `by: "person"`**: `limit` now counts people, not messages, so `limit: 20` lists 20 people when that many replied. The walk reads on until the next person's reply, up to 10 messages per person asked for, and `meta.notes` says where it stopped. This changes behaviour: the same call can now read more replies, and more requests, than before. `by: "message"` is unchanged.
- **`variant_test`** returns a `finding` sentence on every answer. When every step has one variant it says so ("No step has two variants to compare") instead of an empty list with zero totals and nothing else.
- **Campaign names**: after an exact name (ignoring case), a name with a word that begins with the text is preferred over one that merely contains it, so `UG` no longer matches `Mug buyers` when `UG founders` exists. The refusal for several matches still lists how many and which, and now says a ref also skips reading every campaign.
- **Dates on the CLI**: `--from`, `--to` and `--since` each take a day (`YYYY-MM-DD`) or an ISO 8601 date and time with its offset, and refuse anything else with one message. `--from`/`--to` given a time count the UTC day it falls on. `--since` no longer accepts forms like `11/10/2026`, which `Date.parse` used to read in local time.
- **`outbound tools | head`** and any reader that closes the pipe early: the CLI exits 0 quietly instead of printing an unhandled `EPIPE` stack.
- **`meta.computedAt`** on an insight is when the answer was finished, not when the run started. With `now` passed (meant for tests) it stays that time.
