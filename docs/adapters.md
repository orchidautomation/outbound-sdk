# Adapters

Three adapters ship today. Each was written from the vendor's public API documentation read on 2026-11-14 and tested offline against documented payloads. Each has two layers: normalized reads that mean the same thing on every vendor, and a typed catalog of the vendor's own reads for everything else.

- **HeyReach and Instantly are `beta`:** their reads were run, read-only, against one live workspace each on 2026-11-14. Both runs fixed things the documentation got wrong or left out: HeyReach's sequence layout, and Instantly's step numbering (steps count from 0 and an email names its step as `0_6_0`).
- **Smartlead is `unverified`:** it has not been run against a live account.

`outbound.caveats` lists what each adapter assumes, and `npm run test:live` (see below) is how an adapter is confirmed.

| Adapter | Import | Channel | Key | Research |
| --- | --- | --- | --- | --- |
| Instantly (API V2) | `outbound-sdk/instantly` | email | `INSTANTLY_API_KEY` | `docs/research/instantly.md` |
| Smartlead | `outbound-sdk/smartlead` | email | `SMARTLEAD_API_KEY` | `docs/research/smartlead.md` |
| HeyReach | `outbound-sdk/heyreach` | LinkedIn | `HEYREACH_API_KEY` | `docs/research/heyreach.md` |
| In-memory | `outbound-sdk/memory` | both | none | for tests and demos |

Each factory also takes `workspaceId` (a label for the client or workspace, part of every ref; defaults to `<PROVIDER>_WORKSPACE_ID`, then `default`), `baseUrl` and `capabilities` (to override what the adapter declares, for example on a plan without an endpoint).

## What each adapter can do

Generated from the adapters' own declarations. A filter is `server` (the vendor filters), `client` (the SDK filters after fetching and marks the result `derived`) or `no`. A stat is `exact`, `derived` or `no`. A call that needs a `no` is refused as `Unsupported` before any request leaves.

| Capability              | Instantly | Smartlead | HeyReach |
| ----------------------- | --------- | --------- | -------- |
| `blocklist`             | yes       | yes       | yes      |
| `campaigns.settings`    | yes       | yes       | no       |
| `campaigns.status`      | server    | client    | server   |
| `deletionDetection`     | no        | no        | no       |
| `events.parse`          | yes       | yes       | yes      |
| `events.verify`         | secret    | signature | secret   |
| `leads.byCampaign`      | yes       | yes       | yes      |
| `leads.engagement`      | yes       | no        | no       |
| `leads.get`             | yes       | yes       | yes      |
| `leads.list`            | yes       | yes       | no       |
| `leads.since`           | client    | client    | server   |
| `leads.timeline`        | yes       | yes       | yes      |
| `lists.leads`           | yes       | no        | yes      |
| `lists.list`            | yes       | yes       | yes      |
| `messages.body`         | full      | full      | full     |
| `messages.byThread`     | yes       | yes       | yes      |
| `messages.list`         | yes       | yes       | yes      |
| `messages.since`        | server    | client    | server   |
| `native`                | yes       | yes       | yes      |
| `replies.category`      | vendor    | vendor    | no       |
| `replies.list`          | yes       | yes       | yes      |
| `replies.since`         | server    | client    | server   |
| `senders.byCampaign`    | yes       | yes       | yes      |
| `senders.get`           | yes       | yes       | yes      |
| `senders.health`        | yes       | yes       | yes      |
| `senders.list`          | yes       | yes       | yes      |
| `senders.warmup`        | yes       | yes       | no       |
| `sequence`              | yes       | yes       | yes      |
| `sequence.subsequences` | yes       | yes       | no       |
| `stats.byDay`           | exact     | exact     | exact    |
| `stats.bySender`        | derived   | exact     | exact    |
| `stats.byStep`          | exact     | exact     | no       |
| `stats.campaign`        | exact     | exact     | exact    |
| `stats.workspace`       | exact     | exact     | exact    |
| `tags`                  | yes       | yes       | no       |
| `webhooks.list`         | yes       | yes       | yes      |
| `workspaces`            | yes       | yes       | no       |

What a vendor's API cannot answer stays `no`, and the adapter's research note says why:

- **HeyReach has no campaign settings, subsequences, tags or per-lead counts.** Its API can set a campaign's schedule but not read it, a campaign has one sequence tree, no endpoint lists the workspace's tags, and no lead carries open or reply counts.
- **HeyReach replies carry no category.** Its auto-tags describe the lead, not a message; the newest one is the lead's `interest`.
- **HeyReach has no list of every lead.** Leads are read per campaign or per saved list.
- **Smartlead cannot list the leads of a saved list**, and its per-lead counts are documented only as a placeholder response.
- **Instantly's per-mailbox stats are `derived`:** its mailbox analytics exist per day only.
- **No adapter reveals deleted records.** Use the `reconcile` plugin's `deletions()`.

## Native reads: nothing a vendor reports is dropped

The normalized reads are the part all three vendors share. Everything else a vendor can report is in the adapter's native catalog and comes back as the vendor sent it:

```ts
const outbound = createOutbound({ adapter: smartlead() });

// Typed from the adapter: the name and its parameters autocomplete.
const unread = await outbound.native.reads.inboxUnread({ limit: 20 });

// Or by a name learned at run time.
outbound.native.catalog; // every read, with its parameters and a docs link
await outbound.native.read("inboxUnread", { limit: 20 });
```

A native read goes through the same request engine as a normalized one: it is rate limited, retried and normalized on failure, and keys never reach an error. It can only be a read. Each call is one vendor request; pass the vendor's own paging parameters to page. The response is not normalized and not redacted, so `outbound.native` is turned off when the `redact` plugin is on. On a combined instance, use `outbound.workspace(id).native`.

`outbound.raw` is still there for a request the catalog does not name.

### Coverage

`docs/coverage/<vendor>.md` lists every endpoint in each vendor's API reference and how the SDK reaches it. `npm test` checks each table against the adapter.

| Vendor | Endpoints | Normalized | Native | Excluded | Writes |
| --- | --- | --- | --- | --- | --- |
| [Instantly](coverage/instantly.md) | 268 | 22 | 105 | 4 | 137 |
| [Smartlead](coverage/smartlead.md) | 230 | 27 | 78 | 20 | 105 |
| [HeyReach](coverage/heyreach.md) | 106 | 17 | 25 | 3 | 61 |

A read is excluded only when it returns secrets (API keys, mailbox passwords, proxy credentials), reports nothing about campaigns, leads, senders or results (billing, marketplace pricing, search filter lists), or returns a file the SDK cannot carry (one HeyReach voice-message audio endpoint). Reads that spend credits are listed as writes.

## Rate limits each adapter declares

The SDK uses `share` (default 0.5) of these published numbers, because the limit is shared with the customer's other tools.

| Adapter | Published limit | Stricter lanes |
| --- | --- | --- |
| Instantly | 100 per second and 6,000 per minute, per workspace | `GET /emails`: 20 per minute |
| Smartlead | 60 per minute (safe for a client key; an admin key is documented at 200) | three endpoints at 10 per minute |
| HeyReach | 300 per minute; the scope is not documented | none |

## Confirming an adapter against a live account

```sh
LIVE_TESTS=1 INSTANTLY_API_KEY=... npm run test:live
```

The live tests only read. They list campaigns and read one back, exercise each declared capability once, call every native read that needs no input, and check the rate budget. They run only when `LIVE_TESTS=1` and the provider's key are set, and are never part of `npm test` or CI. An adapter moves to `beta` once its reads have been run against a live account, and to `stable` once its fixtures are captured responses and the live tests pass on a schedule.
