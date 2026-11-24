---
"outbound-sdk": patch
---

Instantly `stats({ scope: "step" })` leaves out the row `/campaigns/analytics/steps` returns with `step: null` (sends Instantly could not tie to a step), with a note giving its sends. Before, it came back as a step row with `stepIndex: null`, which cannot be keyed. Those sends stay in the campaign's totals.
