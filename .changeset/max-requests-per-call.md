---
"outbound-sdk": minor
---

Request caps now say their scope in their name (OUT-80, decided in OUT-76).

- `createOutbound({ maxRequestsPerCall })` is the new name for the instance cap. It caps each SDK call, not the whole run. `maxRequests` on `createOutbound` still works for now: it warns once that it is deprecated. Setting both is `Invalid`. `maxRequests` on a single call keeps its name.
- **Breaking:** `budget({ maxRequests })` now defaults to `per: "run"`, a total across every call until `requestBudget.reset()`. To keep the old per-call behaviour, add `per: "call"`, or move the cap to `maxRequestsPerCall`, which does the same thing.

Migration: replace `createOutbound({ maxRequests: n })` with `createOutbound({ maxRequestsPerCall: n })`, and add `per: "call"` to any `budget()` that relied on the per-call default.
