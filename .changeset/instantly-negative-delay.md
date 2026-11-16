---
"outbound-sdk": minor
---

A negative step delay from Instantly no longer fails the whole sequence read (OUT-110). Instantly returned `delay: -11` on a live campaign although its reference allows 0 to 527040; the step it applies to now has `delayDays: null`, and the read says why in `meta.notes`, for example "Step 4's delay is negative in Instantly (-11 days); left out." A negative `pre_delay` on a subsequence and a `delay_unit` outside minutes, hours and days get the same treatment. `sequence`, `step_funnel`, `copy_audit`, `copy_preview` and `campaign_diagnosis` answer again for such a campaign, and their notes carry the reason.

`ResultMeta` gains `notes: string[]`, empty when nothing was left out, and `AdapterContext` gains `note(text)` for adapters to fill it. The CLI's envelope and every insight's `meta.notes` include them.

`copy_reuse` leaves out a campaign whose sequence or step stats the vendor cannot answer for (a `NotFound` or `Provider` error) with a note and `complete: false`, and returns the rest, instead of failing for the whole workspace.
