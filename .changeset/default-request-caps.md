---
"outbound-sdk": minor
---

**Behaviour change:** insights and tool calls now have a request cap by default (OUT-77), and an insight that cannot afford its input is refused before its first request (OUT-79).

- Each insight states its cost, worked out from the input and the adapter's declared costs as a least and a most. It runs under a cap of the most, a quarter more for retries and 4 on top, counted across every read of the run. `maxRequests` in an insight's options replaces it; `Infinity` removes it. `insightCost(outbound, name, input)` returns `{ min, max, defaultCap }`, or `null` where costs are unknown (a combined instance), which keeps the old behaviour.
- A run whose least cost is over its cap, or over what a `budget({ per: "run" })` has left, fails with `RateLimited` (`limit: "call"`, permanent) before any request, and again after its campaign listing once the count is known. The message names the least, the most, the cap and the input to lower.
- Each tool call gets a fresh allowance: 100 requests for a built-in tool, the insight's default up to 500 for an insight tool. Set `maxRequestsPerToolCall` on `createTools` or `insightTools`; `Infinity` removes it. A tool's `call` takes `{ maxRequests }` as a second argument. The MCP server applies the same default on top of its per-call budget reset.
- Tool failures carry `error.retryable` and, when requests were spent, `meta.requests`. A cap stop no longer tells the model "Check the input and try again.": it says not to call again with the same input, and what to lower or ask the user to raise.
- `OperationCost` takes `perWalk` and `perPageAtMost`, upper-bound extras used only for caps; the Smartlead, Instantly and HeyReach adapters declare them. `requestBudget.per` says whether a budget counts per call or per run. Custom insights can declare `cost` and `scales`; the context has `campaignsFound(count)`.
