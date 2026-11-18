---
"outbound-sdk": minor
---

Stats rows add `meetingsBooked`, the vendor's count of meetings booked (OUT-162). Instantly fills it from `total_meeting_booked` on one campaign's total and the workspace total; every other row, and every other adapter, has it `null`, and `outbound.fields.metricRow.meetingsBooked` is `false` on Smartlead, HeyReach and EmailBison. `periodComparison` and `clientReport` carry it in each period's numbers and in `change`, never filled from opportunities or positive replies, with a note when it is `null` or counts only some campaigns.

Warehouse loads get a stable schema (OUT-167). `export()` takes `record` (such as `"reply"` or `"metricRow"`) and then writes every field of that record, `null` where a vendor leaves one out, so files from different vendors share their columns. `outbound-sdk/exporter` adds `recordColumns`, `recordJsonSchema` (JSON Schema of an exported row) and `duckdbTable` (a typed `CREATE TABLE` that `COPY` loads a `.jsonl` export into), all generated from the record schemas. `fillDays(rows, { from, to, fill })` makes daily stats dense: a day the vendor returned no row for gets one with `evidence: "derived"` and counts `null`, or 0 with `fill: "zero"` for the counts the scope reports. Instantly's daily rows now carry `timezone: "UTC"` instead of `null`.
