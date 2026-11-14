# Architecture

`outbound-sdk` is one read-only API over outbound sending tools. One `Outbound` instance wraps one adapter. The wrapper owns everything that is the same for every vendor; an adapter only describes requests and maps responses.

## Layers

```
caller
  -> Outbound (collections, handles)      src/internal/outbound/
       input checks, capability gate      throws Invalid / Unsupported before any I/O
       plugins (ordered onion)            wrap, capabilities, extend, event
       dispatch                           one Operation -> one adapter method
  -> adapter                              src/<provider>/  (request specs + mapping only)
  -> request engine                       src/internal/engine/
       rate budget, concurrency, retries, timeouts, hooks
  -> fetch
```

Only `src/internal/` may call `fetch`. An adapter reaches the network through `ctx.request()`, so no adapter can bypass the rate budget.

## The request engine

Every HTTP call goes through `RequestEngine`.

- **One budget per credential.** Budgets are keyed by provider and a hash of the key, and live in a process-wide registry, so ten instances on one workspace share one budget.
- **Several windows at once.** A request must fit every window the adapter declares, plus its lane's windows when the endpoint has its own stricter cap.
- **Share.** The SDK uses `share` (default 0.5) of the vendor's published limit, because the limit is shared with the customer's other tools.
- **Adaptive.** After a 429 the lane pauses for `Retry-After` and the rate halves, then climbs back 5% per successful request. Rate-limit headers, when a vendor sends them, pause the credential until the reset.
- **Retries are on by default** (4), because every call is a read. 408, 429, 5xx, network errors and per-attempt timeouts retry with exponential backoff and full jitter (1 s base, 60 s cap). 400, 401, 403, 404 and 422 never retry. A caller's abort stops at once.
- **Budgets a caller sets:** `timeout` per attempt, `deadline` across retries and throttle waits, and `maxRequests` per call.
- **Pluggable store.** `RateLimitStore` is in memory by default. `outbound-sdk/redis` shares one budget between processes; implement the same three methods for Cloudflare KV, a Durable Object or a database.

## Capabilities

An adapter declares what it can do as a flat map (`Capabilities`). Anything it does not declare is unsupported. Values are graded: a filter is `server`, `client` or `false`; a stat is `exact`, `derived` or `false`. The wrapper checks the map before any request and before any plugin. When a filter is `client`, the wrapper filters after fetching and marks the result `derived`.

## Two layers of reads

Modelled on Files SDK: a small unified surface, and a typed way down to the vendor for everything else.

- **Normalized reads** are what every vendor shares: campaigns and their settings, sequences, senders and their health, leads, lists, messages, replies, stats, tags, the block list and webhooks. They return the SDK's own records and mean the same thing on every adapter.
- **Native reads** are the rest. No outbound vendor publishes a client of its own, so each adapter declares a catalog (`defineNative`) and the instance exposes it as `outbound.native`, typed from the adapter that was passed in. A native read is one vendor request through the same engine, and returns the vendor's payload untouched.

`docs/coverage/<vendor>.md` accounts for every endpoint a vendor documents, and a test holds each table to the adapter. An adapter may not drop a read: it normalizes it, catalogues it, or excludes it for one of the reasons in `docs/coverage/README.md`.

## Results

Every result carries `meta`: `evidence` (`exact`, `sampled`, `derived`), `fetchedAt`, `complete`, `throttledMs`, `requests`, `provider`, `workspaceId` and `stale`. Records are checked against their Zod schema on the way out, so an adapter or plugin that returns a malformed record fails in the SDK and not in the caller.

## Pagination

Each adapter maps its own style to a `next` value. Callers see one opaque cursor string that also records the provider, workspace and listing it belongs to. `listAll` walks pages under the rate budget and advances its `cursor` only after a page is fully handed out, so a walk that dies restarts on the page it was reading (at-least-once delivery, never a skipped record).

## Plugins

`plugins[0]` is the outermost layer. A plugin may `wrap` operations, narrow `capabilities` (widening is ignored), `extend` the instance with new methods (a name clash is an error) and rewrite webhook `event`s.

## Errors

One class, `OutboundError`, with a `code`: `NotFound`, `Unauthorized`, `RateLimited`, `Provider`, `Invalid`, `Unsupported`. It also carries `status`, `provider`, `retryAfterMs`, `aborted`, `timedOut`, `permanent` and the original error in `cause`. API keys and email addresses are removed from every message and from `cause`, which is a redacted copy: a vendor response becomes plain data, and another error becomes a new error with the same name, message and stack.
