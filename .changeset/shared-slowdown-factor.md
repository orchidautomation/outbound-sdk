---
"outbound-sdk": minor
---

`RateLimitStore` gains two optional methods, `readFactor(key)` and `writeFactor(key, factor)`, so the slowdown after a 429 is shared: a budget reads the saved factor the first time it acquires and writes it each time it changes, so a new process or serverless invocation starts slowed down right after another was throttled. `outbound-sdk/redis` implements both, keeping the factor for 10 minutes. A store without them keeps the factor in memory per process, as before.
