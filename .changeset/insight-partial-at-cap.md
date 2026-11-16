---
"outbound-sdk": minor
---

An insight stopped part way by a request cap returns what it read (OUT-116).

- **Partial answers.** `senderCapacity`, `senderLoad`, `periodComparison`, `campaignRanking`, `clientReport` and `hotLeads` no longer throw `RateLimited` when their own cap, a `budget()` or `maxRequestsPerCall` stops them mid-run. They return `meta.complete: false` with a note naming the cap, what raises it and how much was read, for example `Read 18 of 24 active campaigns; the answer covers those.` A campaign whose own reads were cut off is left out rather than counted with part of its data. Workspace-wide reads (totals, unusual days, daily sends) now run before the per-campaign reads so they survive a stop. Other insights fail as before.
- **Custom insights.** `defineInsight` takes `partialOnCap: true` to opt in, and the context has `each(items, read, what)` for item-by-item reads that keep what finished.
- **Wording per surface.** The CLI and `outbound mcp` name `--max-requests` in every cap message, never `maxRequests`, `budget()` or `requestBudget.reset()`. `budget()` takes a `setting` option for that, and `insightTools` takes `capSetting`. A refusal now says "left of the run's budget" instead of "left of budget()'s run".
- **CLI.** `--max-requests` now replaces an insight's default cap as well as capping the command, so raising it actually lets a capped insight finish.
