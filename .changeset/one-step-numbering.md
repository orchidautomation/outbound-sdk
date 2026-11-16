---
"outbound-sdk": minor
---

Every answer that names a sequence step now gives it two ways, and `step_funnel` no longer calls a step reliable on one reply (OUT-96).

- **New fields:** `stepIndex` (counted from 0, as vendors and records count) and `stepNumber` (counted from 1, as a person counts) on the rows of `stepFunnel`, `variantTest`, `copyAudit`, `copyPreview` and `personalizationGaps`' uses. `stepFunnel` adds `topStepIndex`, `topStepNumber`, `lastStepEarningPlaceIndex` and `lastStepEarningPlaceNumber`; `personSummary`'s campaigns add `lastStepIndex`, `lastStepNumber`, `repliedStepIndexes` and `repliedStepNumbers`. The `winning_steps` tool adds `step_index`, `step_number` and `rank` (1 is the highest reply rate).
- **Deprecation:** `step` on those rows, `stepFunnel`'s `topStep` and `lastStepEarningPlace`, `personSummary`'s `lastStep` and `repliedSteps`, and `winning_steps`' `step` keep their old meaning (counted from 0) and are deprecated. They will be removed in 0.8.0. Read the `…Index` field for the same value, or the `…Number` field to show a person.
- **Correctness fix that changes reported answers:** a `stepFunnel` step needs at least 5 replies to earn its place. Above the bar on fewer, `earnsPlace` is `null` (it was `true`), it is not `lastStepEarningPlace`, and the finding says there are too few replies to tell. A step at or under the bar is still `false`.
- Sentences say the step number with the sequence's length: "Step 2 (of 4) brings the most replies".
- `winning_steps` lists counts the vendor tied to no step last, with `unattributed: true` and `rank: null`, and leaves out such a row when it has no counts.
