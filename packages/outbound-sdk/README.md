# outbound-sdk

One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead and HeyReach.

- **Read-only.** It never sends, pauses, edits or deletes anything in a vendor tool.
- **Stores nothing.** A plugin that keeps state takes a store you supply.
- **Calls no AI model.** Your agent does the reasoning; the SDK supplies the numbers.
- **Swap the adapter, keep the code.**

> HeyReach is `beta`: its reads were run once against a live workspace. Instantly and Smartlead are `unverified`: written from public documentation and tested offline. `outbound.caveats` lists what each adapter assumes.

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

Collections: `campaigns`, `senders`, `leads`, `messages`, `replies`, `workspaces`, each with `list` and `listAll`, and `get`, `exists` and `getMany` where a record can be looked up. Handles: `campaign(id)`, `sender(id)`, `lead(id)`. Also `stats()`, `limits()`, `estimate()`, `capabilities`, `caveats` and `raw` (the vendor's own API, reads only unless `allowWrites: true`).

## It tells you what it cannot do

An adapter declares what it supports. A call that needs something unsupported throws `Unsupported` before any request leaves:

```ts
outbound.capabilities["replies.category"]; // "vendor" or false
```

There is one error class, `OutboundError`, with a `code`: `NotFound`, `Unauthorized`, `RateLimited`, `Provider`, `Invalid` or `Unsupported`. API keys and email addresses are removed from every message.

## Rate limits, retries and resuming

You never write a sleep or a retry loop. Every request stays inside every limit the vendor publishes, one budget is shared by every instance on the same key, a 429 is waited out, and reads are retried with backoff. `listAll` exposes a `cursor`, so a job that dies on page 40 restarts on page 40. Set `timeout`, `retries`, `deadline` and `maxRequests` on the constructor or on any call.

## More

- [Adapters and what each can do](https://github.com/orchidautomation/outbound-sdk/blob/main/docs/adapters.md)
- [Plugins](https://github.com/orchidautomation/outbound-sdk/blob/main/docs/plugins.md): `combine`, `clients`, `identity`, `redact`, `cache`, `budget`, `audit`, `tracing`, `sync`, `reconcile`, `alerts`, `benchmarks`, `fixtures`, `exporter`, `failover`
- [AI tools, the MCP server, the CLI and webhooks](https://github.com/orchidautomation/outbound-sdk/blob/main/docs/tools-and-webhooks.md)
- [Architecture](https://github.com/orchidautomation/outbound-sdk/blob/main/docs/architecture.md)

## License

MIT
