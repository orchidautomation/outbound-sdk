---
"outbound-sdk": minor
---

**Breaking:** every CLI command prints one JSON envelope, and every tool reports coverage in one place (OUT-102).

- **CLI output.** Every command prints `{ ok, data, meta: { complete, notes, provider, requests }, next? }`. A list is in `data.items` instead of a bare array. A record is `data`, with its `meta` lifted into the envelope's `meta`. An insight's answer and a `native` read are `data`, and an insight's name is `meta.insight`. A tool's result keeps `ok`, `data` and `next`. `--card` and `--slack` put the card or the Slack message in `data`. When `--limit` cut a list, `meta.complete` is `false` and `meta.notes` holds the same note standard error gets. `meta.requests` counts the vendor requests the command sent.
- **CLI failures.** A failure prints `{ ok: false, data: null, error: { code, message }, meta }` on standard output as well as `<code>: <message>` on standard error. `thread` with an id that has no messages, and `leads --campaign` or `--list` naming one that does not exist, now exit 1 with `NotFound`, as `campaign`, `health` and the others already did. `mcp`, `version` and `update` print no envelope.
- **Tools.** `ToolSuccess.meta` has two new required fields, `complete` and `notes`, which every built-in tool and every insight tool fills. A tool of your own must set them. The per-tool fields that said the same thing are gone: `truncated` (`campaign_overview`, `sender_health`, `reply_samples`), `all_checked` (`sender_health`, `deliverability_check`) and `counting_stopped_at_max` (`lead_runway`). `deliverability_check`'s coverage note moved from `next` to `meta.notes`.
- **Insight tools.** `data` is the insight's answer itself, no longer `{ complete, notes, result }`; read coverage from `meta.complete` and `meta.notes`. The answer keeps its camelCase keys.
- **Cards** read coverage from the result's `meta`, so a tool card shows the tool's own notes in its footer.

Migration: read a CLI list from `.data.items` and a record from `.data`; read coverage from `meta.complete` and `meta.notes` instead of `truncated`, `all_checked`, `counting_stopped_at_max` or an insight tool's `data.complete`; and read an insight tool's answer from `data` instead of `data.result`.
