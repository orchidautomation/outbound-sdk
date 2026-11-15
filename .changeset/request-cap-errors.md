---
"outbound-sdk": minor
---

- A request cap of your own no longer looks like a vendor 429 (OUT-70). `OutboundError` has a new `limit` field on `RateLimited`: `"vendor"` for a 429, `"deadline"` for a full rate budget the deadline would not wait for, `"call"` for a per-call cap (`maxRequests` or `budget({ per: "call" })`) and `"run"` for a spent `budget({ per: "run" })`. A `"call"` or `"run"` stop is `permanent: true`, so a retry loop that follows `permanent` stops on it. `code` is still `RateLimited`. The message says what to change. New type: `RequestLimit`.
