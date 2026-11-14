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

## Writing a plugin

A plugin is an object with a `name` and any of:

- `wrap(operation, next, info)`: intercept an operation. Call `next` to continue inward.
- `capabilities(capabilities)`: return what to advertise. Anything it widens is ignored.
- `extend(outbound)`: add methods to the instance. A name that already exists is an error.
- `hooks`: observe calls and HTTP requests.
- `event(event)`: rewrite a webhook event, or return `null` to drop it.

Rules: fail closed (throw `Unsupported` rather than pass data through unprotected), narrow capabilities and never widen them, and test against the in-memory adapter, including the orders that matter.
