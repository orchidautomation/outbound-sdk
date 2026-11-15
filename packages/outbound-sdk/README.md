# outbound-sdk

One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead and HeyReach.

- **Read-only.** It never sends, pauses, edits or deletes anything in a vendor tool.
- **Stores nothing.** A plugin that keeps state takes a store you supply.
- **Calls no AI model.** Your agent does the reasoning; the SDK supplies the numbers.
- **Swap the adapter, keep the code.**

> HeyReach and Instantly are `beta`: their reads were run against a live workspace each. Smartlead ships untested: it has never been run against a live account, and is written from public documentation and tested offline only.

## Install

```sh
npm install outbound-sdk
```

Node 22 or later, Bun, or any runtime with `fetch`. `zod` is the only dependency.

## Use

```ts
import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const outbound = createOutbound({ adapter: instantly() }); // reads INSTANTLY_API_KEY

const page = await outbound.campaigns.list({ status: "active", limit: 100 });

for await (const campaign of outbound.campaigns.listAll()) {
  // every page, fetched under the vendor's rate limit
}

const campaign = outbound.campaign(page.items[0].ref);
await campaign.sequence();
await campaign.stats({ from: "2026-10-01", to: "2026-10-31", by: "day" });
for await (const lead of campaign.leads.listAll()) {
}
```

Change the vendor by changing one import:

```ts
import { heyreach } from "outbound-sdk/heyreach";
import { smartlead } from "outbound-sdk/smartlead";
```

Several tools or several clients behind one instance:

```ts
import { combine } from "outbound-sdk/combine";

const outbound = createOutbound({
  adapter: combine([
    instantly({ apiKey: clientA.instantlyKey, workspaceId: "client-a" }),
    heyreach({ apiKey: clientA.heyreachKey, workspaceId: "client-a" }),
  ]),
});
```

## What you get back

Every record carries `provider`, `workspaceId` and a `ref` (`provider:workspace:id`), so data from two tools or two clients can never be confused. A count the vendor does not report is `null`, never `0`. Every result carries `meta`:

```ts
page.meta; // { evidence: "exact" | "sampled" | "derived", fetchedAt, complete, requests, throttledMs, stale, ... }
```

Collections: `campaigns`, `senders`, `leads`, `messages`, `replies`, `lists`, `tags`, `blocklist`, `webhooks` and `workspaces`, each with `list` and `listAll`, and `get`, `exists` and `getMany` where a record can be looked up. Handles: `campaign(id)` (with `settings()`, `sequence()`, `subsequences`, `stats()`), `sender(id)` (with `health()`, `warmup()`, `stats()`), `lead(id)`, `list(id)` and `thread(id)`. Also `stats()`, `limits()`, `estimate()`, `capabilities` and `caveats`.

## Nothing a vendor reports is dropped

The collections above are what every vendor shares. Everything else a vendor can report is in `outbound.native`, a catalog typed from the adapter you passed:

```ts
const outbound = createOutbound({ adapter: smartlead() });
const unread = await outbound.native.reads.inboxUnread({ limit: 20 });
unread.data; // Smartlead's own response
```

Native reads are rate limited and retried like the rest, can only read, and return the vendor's payload as sent. `outbound.raw` remains for a request the catalog does not name (reads only unless `allowWrites: true`).

## Answers, not only records

`outbound-sdk/insights` adds 26 computed answers on top of the reads: one person across email and LinkedIn, replies nobody answered, where a sequence's replies come from, whether an A/B winner is real, deliverability per domain, why a campaign is underperforming, a weekly client report. Each is a typed method, an agent tool and a CLI command, and none calls a model.

```ts
const outbound = createOutbound({ adapter, plugins: [insights()] });
const person = await outbound.insights.personSummary({
  person: "jane@example.com",
});
```

See [the insights](https://outbound-sdk.dev/docs/insights).

## It tells you what it cannot do

An adapter declares what it supports. A call that needs something unsupported throws `Unsupported` before any request leaves:

```ts
outbound.capabilities["replies.category"]; // "vendor" or false
```

There is one error class, `OutboundError`, with a `code`: `NotFound`, `Unauthorized`, `RateLimited`, `Provider`, `Invalid` or `Unsupported`. API keys and email addresses are removed from every message, and from the `cause` an error keeps (a redacted copy of the vendor response or the original error).

## Rate limits, retries and resuming

You never write a sleep or a retry loop, and you can fire hundreds of reads at once. Every request stays inside every limit the vendor publishes, one budget is shared by every instance on the same key, a 429 is waited out, and reads are retried with backoff. `listAll` exposes a `cursor`, so a job that dies on page 40 restarts on page 40. Set `timeout`, `retries`, `deadline` and `maxRequests` on the constructor or on any call. With several workers on one key, `outbound-sdk/redis` shares one budget between them.

## More

- [Adapters and what each can do](https://outbound-sdk.dev/docs/adapters)
- [Plugins](https://outbound-sdk.dev/docs/plugins): `combine`, `clients`, `identity`, `redact`, `cache`, `budget`, `audit`, `tracing`, `sync`, `reconcile`, `alerts`, `benchmarks`, `fixtures`, `exporter`, `failover`
- [AI tools](https://outbound-sdk.dev/docs/tools), the [CLI and MCP server](https://outbound-sdk.dev/docs/cli) and [webhooks](https://outbound-sdk.dev/docs/webhooks)
- [Guides](https://outbound-sdk.dev/guides) and [what is verified](https://outbound-sdk.dev/docs/status)
- [Architecture](https://github.com/orchidautomation/outbound-sdk/blob/main/docs/architecture.md)

## License

MIT
