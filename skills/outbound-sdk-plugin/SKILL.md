---
name: outbound-sdk-plugin
description: Write a plugin for outbound-sdk, a plain object that wraps every read, narrows capabilities, adds typed methods to the instance, observes hooks or rewrites webhook events, and test it on the in-memory adapter. Also says where adding a new vendor adapter is documented. Use when someone wants to log, cache, scope, mask, count or change what an outbound-sdk instance reads, or asks how to support another sending tool.
---

# Writing an outbound-sdk plugin

A plugin is a plain object with a `name` and up to five optional members. Its type is `OutboundPlugin` from `outbound-sdk`. There is no base class and nothing to register: pass it in `plugins` to `createOutbound`.

Before writing one, check whether a shipped plugin already does the job: `cache`, `failover`, `budget`, `redact`, `clients`, `identity`, `sync`, `reconcile`, `audit`, `alerts`, `tracing`, `benchmarks`, `exporter`, `fixtures` and `insights`. The [plugins](https://outbound-sdk.dev/docs/plugins) page says what each one does.

## The contract

| Member | What it is for |
| --- | --- |
| `name` | Required, and unique on an instance. It names the plugin in errors. |
| `wrap(operation, next, info)` | Intercepts every read. Call `next(operation)` to continue toward the adapter. |
| `capabilities(capabilities)` | Returns what the instance should advertise. It can only take away. |
| `extend(outbound)` | Returns properties to add to the instance, typed by `OutboundPlugin<Extension>`. |
| `hooks` | Observes calls, errors, HTTP requests, retries and throttle waits. Fire and forget. |
| `event(event)` | Rewrites a webhook event, or returns `null` to drop it. It runs only when you pass `plugins` to `parse()` from `outbound-sdk/webhooks`. |

The [writing a plugin](https://outbound-sdk.dev/docs/plugins/writing-a-plugin) page is the full reference. Fetch it before using a member this skill does not show.

Facts that decide a design:

- **An operation is one read**: a `kind` (`campaigns.list`, `leads.get`, `stats` and so on) with a `query` or an `id`. One `listAll` walk is one operation per page.
- **`wrap` returns an `OperationOutput`**: `items`, `next`, `evidence`, and optionally `stale` and `fetchedAt`. Each record is checked against the read's schema, and a record that does not match fails the call with `Provider`. Extra fields on a record are kept.
- **Refusals happen before `wrap`.** A read the adapter does not declare, or bad input, is refused before any plugin runs.
- **`extend` runs once per instance**, and again for every `outbound.workspace(id)`. Keep state in the factory's closure so those scoped instances share it.

## A worked plugin

[examples/read-log.ts](examples/read-log.ts) hands every read to a sink the caller supplies, and adds `outbound.readLog.count()` and `outbound.readLog.failed()`. [examples/run.ts](examples/run.ts) tests it, and [examples/run.out.txt](examples/run.out.txt) is what the test printed. It shows that:

- the sink receives one entry per operation, with the read's `evidence`
- a sink that throws does not fail the read, and is counted as failed
- a read the adapter cannot serve is `Unsupported` and never reaches `wrap`
- the same plugin listed twice throws `Invalid` when the instance is built

## The rules

These follow from the SDK's product boundary. A plugin that breaks one breaks a promise the SDK makes to its users.

1. **Stay read-only.** Never send, pause, edit or delete anything in a vendor tool, and never call an AI model.
2. **Store nothing of your own.** A plugin that keeps state takes a store from the caller, as `cache`, `sync` and `failover` do. The worked plugin takes a `sink`.
3. **Narrow, never widen.** `capabilities` can turn a capability off or lower its grade. Anything you widen is ignored. To refuse a whole kind of read up front, turn it off there, so it is refused before any request.
4. **Fail closed when you protect data.** Refuse what you do not recognize with `new OutboundError("Unsupported", …)` rather than pass it through untouched.
5. **Keep counts honest.** Never turn a `null` count into `0`. If `wrap` filters or computes what it returns, set `evidence` to `derived`. If it serves a stored answer, set `stale` and `fetchedAt`.
6. **Throw `OutboundError`.** Any other error thrown from `wrap` goes through the adapter's error mapper, which picks the code.
7. **Do not fail a read for a side effect.** A logger, sink or notifier is fire and forget. An awaited store, as in `cache`, may fail the read; say so in your docs.
8. **One namespace.** Put everything `extend` adds under one name, such as `outbound.readLog`. A clash with an existing property throws `Invalid`.
9. **Test on the in-memory adapter**, with `memory({ capabilities })` to stand in for a vendor that declares less, and in every plugin order that matters to yours.

## A new vendor is an adapter, not a plugin

Supporting another sending tool means writing an adapter inside the outbound-sdk repository. The `Adapter` type is exported, but every adapter is reviewed against vendor research, documented payloads and a shared test suite. Follow `docs/new-adapter.md` in the repository, and its `AGENTS.md` rules. In particular:

- vendor facts come from the vendor's current documentation, fetched fresh and recorded in `docs/research/<provider>.md`
- an adapter calls `ctx.request()` and never `fetch`
- an adapter declares only what the documentation supports
- a new adapter starts as `unverified` until its reads have run against a live account

Do not write an adapter in a user's project to get around this.
