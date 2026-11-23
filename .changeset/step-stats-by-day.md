---
"outbound-sdk": minor
---

A new capability, `stats.byStepDay`, gates a step's stats by day: `campaign(id).stats({ scope: "step", by: "day" })` (OUT-216).

- An adapter that declares it, such as the memory adapter or your own adapter over stored history, serves a row per step and day. Every vendor adapter declares it `false`, because Instantly, Smartlead and EmailBison report step counts only as totals over a range and HeyReach has no step stats, so the read is `Unsupported` before any request, now from the capability check instead of from inside the adapter.
- `step_funnel` takes `by_day`, which adds `days`: each day's sends and replies per step, for one more request. It is refused before any request where the adapter lacks `stats.byStepDay`. Without `by_day`, `days` is `null`.
- The Smartlead and EmailBison pages say that neither vendor has a daily read that keeps campaigns apart, so daily stats for every campaign cost one request per campaign (OUT-217).
