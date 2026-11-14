# Plugins

Plugins are optional. Each one is its own subpath (`outbound-sdk/<name>`), stores nothing on our side and calls no AI model. A plugin that keeps state takes a store you supply.

```ts
import { createOutbound } from "outbound-sdk";
import { budget } from "outbound-sdk/budget";
import { cache } from "outbound-sdk/cache";
import { combine } from "outbound-sdk/combine";
import { redact } from "outbound-sdk/redact";

const outbound = createOutbound({
  adapter: combine([
    instantly({ workspaceId: "acme" }),
    heyreach({ workspaceId: "acme" }),
  ]),
  plugins: [redact(), cache({ ttl: 60 }), budget({ maxRequests: 50 })],
});
```

## Order

`plugins[0]` is the outermost layer. The order matters:

1. `redact` first, so nothing leaves the instance unmasked.
2. `clients` and `identity`, which tag records.
3. `cache`, so a repeat read skips everything inside it.
4. `audit` and `tracing`, which then record only real work.
5. `budget` last, next to the request engine.

## Group 1: several tools, several clients

| Plugin | What it does |
| --- | --- |
| `combine([a, b])` | An adapter, not a plugin: several adapters or keys behind one instance. It promises only what every member can do. Every record keeps its own provider and workspace, each member keeps its own rate budget, and a lookup needs a ref (`provider:workspace:id`). Workspace stats come back one row per member and are never added together. |
| `clients({ rules })` | Tags every record with a `client`. Without rules, one workspace is one client. With rules (by provider, workspace, campaign tag, campaign name or campaign ref), the first match wins and anything unmatched is `unassigned`. Adds `outbound.clients.names()` and `outbound.clients.stats()`. A tag or name rule needs the campaign, which is fetched once per campaign. |
| `identity()` | Adds `personKey` and `personKeys` to every lead from exact identifiers only: a lowercased email or a cleaned LinkedIn profile URL. Adds `outbound.person(key)`, which returns every record for the person and one timeline across tools. Records are linked, never merged. `person()` scans leads, so pass `campaignIds` to bound it. |
| `redact({ fields, strategy })` | Masks emails, names, companies, LinkedIn URLs, custom fields, subjects and bodies, and always drops `raw`. `strategy: "hash"` keeps a stable token so people can still be counted. It turns `messages.body` off when bodies are masked and refuses a record it does not recognise. |

## Group 2: cost and visibility

| Plugin | What it does |
| --- | --- |
| `cache({ ttl, store })` | Serves a repeat read from a store for `ttl` seconds. A cached answer keeps its original `meta.fetchedAt`. Failures are not stored. |
| `budget({ maxRequests, per })` | Caps vendor requests per call or per run. The engine stops the call with `RateLimited` when the cap is reached. Retries count. Adds `outbound.requestBudget`. |
| `audit({ sink })` | Records each operation with its duration, request count and throttle time, and optionally each HTTP request with its redacted URL. Entries hold no record data. |
| `tracing({ tracer })` | Emits an OpenTelemetry span per operation and per HTTP request. Pass a tracer from `@opentelemetry/api`. |

## Group 3: keeping a copy in step

| Plugin | What it does |
| --- | --- |
| `sync({ checkpoints })` | Adds `outbound.sync.run(collection, { onPage })`. It keeps a checkpoint per collection in a store you supply: a cursor, so a run that dies restarts on the page it was reading, and the start time of the last finished run, so the next one asks only for newer records, reaching back `overlapMinutes` (default 5). The checkpoint moves only after `onPage` resolves, so a failed page is delivered again. |
| `reconcile()` | Adds `outbound.reconcile.events()`, which compares the webhooks you received with what the vendor lists and reports webhooks that never arrived, events with no record and late delivery, and `outbound.reconcile.deletions()`, which compares a full listing with the refs you hold. A mismatch is reported, never repaired silently. |
| `alerts({ rules, notify })` | Checks fixed rules after each read and calls `notify` with what fired. Built in: `bounceRateAbove`, `replyRateBelow`, `senderNotActive` and `noSends`. A rule is arithmetic on what was just read; no model is involved. A failing notifier cannot fail the read. |

## Group 4: context, files and bad days

| Plugin | What it does |
| --- | --- |
| `benchmarks()` | Adds `outbound.benchmarks.campaign(id)`: a campaign's rates beside its own workspace's over the same dates. No outside benchmark is used. |
| `fixtures({ dir, mode })` | Records answers to disk and replays them, with personal data replaced by numbered placeholders. `replay` never calls the vendor. List it last when recording. |
| `exporter()` | Adds `outbound.export(listing, { to })`, which streams records to a `.csv` or `.jsonl` file as they arrive. For Parquet, DuckDB or anything else, pass a `RowWriter`; the package adds no dependency for those formats. |
| `failover({ store })` | Keeps each successful read in a store you supply and serves it, with `meta.stale: true` and its original `meta.fetchedAt`, when the vendor is down or rate limited. A bad request, a missing record or a rejected key is never papered over. |

## Writing a plugin

A plugin is an object with a `name` and any of:

- `wrap(operation, next, info)`: intercept an operation. Call `next` to continue inward.
- `capabilities(capabilities)`: return what to advertise. Anything it widens is ignored.
- `extend(outbound)`: add methods to the instance. A name that already exists is an error.
- `hooks`: observe calls and HTTP requests.
- `event(event)`: rewrite a webhook event, or return `null` to drop it.

Rules: fail closed (throw `Unsupported` rather than pass data through unprotected), narrow capabilities and never widen them, and test against the in-memory adapter, including the orders that matter.
