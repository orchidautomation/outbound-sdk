---
"outbound-sdk": minor
---

**Correctness fix that changes reported numbers:** `lead_runway` and `pipeline_forecast` now give the same runway (OUT-94). Both divide the active leads not yet started by the new leads started per day over the complete days ending yesterday. `lead_runway` no longer falls back to emails sent when a day has no `contacted` count (its pace is then `null`), no longer counts today's partial day, and returns the unrounded figure `pipeline_forecast` gives as `daysLeft`, including `0` when every lead was read and none is left. Both add the split of active leads: `not_started` and `in_sequence` on `lead_runway`, `notStarted` and `inSequence` on `PipelineForecast`, from each lead's last step sent or last contact; both are `null` when no lead read reports either, and the runway then counts every active lead.
