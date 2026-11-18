---
"outbound-sdk": minor
---

`outbound mcp` keeps a long tool call inside an agent host's timeout (OUT-154).

- Each tool call has a time budget, 50 seconds by default, counted from when the call arrives; `--time-budget <seconds>` sets another, and `createMcpServer` takes `timeBudgetMs` (`Infinity` for none). A rate-limit wait that would pass it is not started and a read under way is stopped, so an insight answers with what it read, `meta.complete: false` and a note naming the budget and how to get the rest. A built-in tool returns `RateLimited` with the same message. This changes behavior: a call that used to run for minutes now answers at the budget unless you raise it.
- A `tools/call` with `_meta.progressToken` gets `notifications/progress` every 5 seconds: seconds so far, the budget as `total`, and how long it has waited on rate limits.
- The server reads messages while a tool call runs: `ping` is answered and `notifications/cancelled` stops the call, which is then not answered. Tool calls still run one at a time. `handle` and `handleLine` take an optional `notify` for progress.
- Throttle messages name the vendor's published limit apart from the rate this process keeps to, as "Instantly's emails rate limit (20 a minute; this process reads up to 10 a minute)". `ThrottleEvent` gains `declared`, the published windows.
