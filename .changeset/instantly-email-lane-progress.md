---
"outbound-sdk": minor
---

A wait on a rate limit is no longer silent. The CLI prints one line on stderr for any wait over 2 seconds, such as "Waiting 60s for Instantly's emails rate limit (10 a minute)…", and every command's `meta` now carries `throttledMs`. An `outbound mcp` tool call that waits more than 5 seconds says so in `meta.notes`. A 429 is reported as "Throttled by Instantly", most likely another process on the same workspace, instead of looking like a hang, and a 429 with no `Retry-After` now pauses the lane until one more request fits (3 s on Instantly's email lane) and counts as throttle time. `onThrottle` events gain `cause` (`budget` or `vendor`) and `windows`. A CLI `--config` file can export `rateLimitStore`, such as `redisRateLimitStore()`, so terminals and MCP servers on one key share one budget.
