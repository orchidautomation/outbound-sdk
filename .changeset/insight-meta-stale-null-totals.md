---
"outbound-sdk": minor
---

Insight answers say more truthfully what they rest on (OUT-196).

- `InsightMeta.stale` is `true` when any read behind the answer was an older answer the failover plugin served because the vendor was down, as `ResultMeta.stale` says on that read. A listing walk's `meta.stale` now stays `true` once any of its pages was stale, not only when the last one was.
- `leadCollisions` and `suppressionCheck` give `totals.collisions` and `totals.violations` of `null`, not 0, when no campaign is in the statuses asked for while others exist (`campaignsRead: 0`, `meta.complete: false`). Their `finding` then says that nothing was checked and how to check the others. A missing count is `null`, never 0.
- The type docs no longer read as if `lead_runway` were an insight. It is an AI tool (`outbound-sdk/tools`, `outbound mcp`), so `listInsights()` does not list it; `pipelineForecast` and `clientReport` give the same runway state and days.
