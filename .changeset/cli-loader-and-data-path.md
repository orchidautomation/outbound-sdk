---
"outbound-sdk": minor
---

Make the CLI a loader, and the data path say what it costs (OUT-160, OUT-161, OUT-163, OUT-164).

- **`--jsonl`** on every listing (`leads`, `campaigns`, `senders`, `lists`, `replies`, `tags`, `blocklist`, `webhooks`, `thread`) and on `stats` prints one record per line as each page arrives, then one `{ meta, ok }` line with `meta.records`.
- **`--cursor`** resumes a listing from the `meta.cursor` an earlier run printed. Pages are read at `--limit`'s size, so a resumed run repeats no record; where it must, `meta.repeats` says how many.
- **Exit code 3** when `--limit` stops a list while more records exist. This changes behaviour: such a run used to exit 0. A script that treats any non-zero exit as failure should accept 3 or read `meta.complete`.
- **`leads --since`** keeps the leads created since a time, reading the whole window up to 2,000 by default, as `replies --since` does. Where the vendor cannot filter by date (Instantly's leads), a note says it costs a full walk.
- **`stats({ scope: "sender" })` without an id** lists every sender and reads them in batches where the vendor allows it (`stats.bySenders`; Instantly, 200 mailboxes a request), instead of failing with `Invalid`. Elsewhere it is `Unsupported` before any request. The CLI's `stats` takes `--scope workspace|campaign|sender` and `--sender ID`.
- **`SyncResult`** carries `requests`, `throttledMs`, `filter` (`server`, `client` or `none`) and `notes`. A run the SDK filtered after reading every record says so, with its cost.
- **`--card`** prints the card as text, `--slack-text` as Slack mrkdwn for the composer, and `--slack` the Slack message's JSON alone, without the envelope, so it pipes to a webhook. `toText(card, { style })` in `outbound-sdk/cards` does the same in code. This changes `--card` and `--slack` output, which used to be the card or message inside the envelope's `data`.
- A card shows every ranked action, such as `client_report`'s, before any other list, so the eight-row cut never hides one.
