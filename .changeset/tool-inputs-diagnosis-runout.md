---
"outbound-sdk": minor
---

Exploring one campaign no longer takes trial and error (OUT-97).

- `outbound tools` lists each tool's inputs as JSON Schema (`parameters`), the way `outbound insight` does. `outbound tool <name>` with no `--input` prints the tool's `name`, `description` and `parameters` when the tool has a required input, instead of failing on it. A tool with no required input still runs.
- `campaign_trend` works with only `campaign`: `to` defaults to today (UTC) and `from` to 30 days before `to`. Its data adds the `from` and `to` it read.
- `campaign_diagnosis` reports `out_of_leads` instead of `falling_sends` or `no_recent_sends` when under a day of leads is left to start at the recent pace of new leads started, the pace `lead_runway` uses. It reads the campaign's leads (new input `max_leads`, default 2,000) only when sends fell or stopped. `DiagnosisCode` adds `out_of_leads`.
- `campaign_diagnosis` screens every sender of the campaign, up to 500 (`max_senders` now defaults to 500, was 50), so a large sender pool no longer makes the answer partial. `inactive_sender` also flags a warmup score of 0, the screen `deliverability_check` uses, and its `numbers` add `warmupZero`.
- `tracking_off` also fires when click tracking is off, and says which tracking is off.
