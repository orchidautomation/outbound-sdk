# Adapters

Three adapters ship today. All three are `unverified`: each was written from the vendor's public API documentation read on 2026-11-14 and tested offline against documented payloads. None has been checked against a live account. `outbound.caveats` lists what each adapter assumes, and `npm run test:live` (see below) is how an adapter is confirmed.

| Adapter | Import | Channel | Key | Research |
| --- | --- | --- | --- | --- |
| Instantly (API V2) | `outbound-sdk/instantly` | email | `INSTANTLY_API_KEY` | `docs/research/instantly.md` |
| Smartlead | `outbound-sdk/smartlead` | email | `SMARTLEAD_API_KEY` | `docs/research/smartlead.md` |
| HeyReach | `outbound-sdk/heyreach` | LinkedIn | `HEYREACH_API_KEY` | `docs/research/heyreach.md` |
| In-memory | `outbound-sdk/memory` | both | none | for tests and demos |

Each factory also takes `workspaceId` (a label for the client or workspace, part of every ref; defaults to `<PROVIDER>_WORKSPACE_ID`, then `default`), `baseUrl` and `capabilities` (to override what the adapter declares, for example on a plan without an endpoint).

## What each adapter can do

Generated from the adapters' own declarations. A filter is `server` (the vendor filters), `client` (the SDK filters after fetching and marks the result `derived`) or `no`. A stat is `exact`, `derived` or `no`. A call that needs a `no` is refused as `Unsupported` before any request leaves.

| Capability           | Instantly | Smartlead | HeyReach |
| -------------------- | --------- | --------- | -------- |
| `campaigns.status`   | server    | client    | server   |
| `sequence`           | yes       | yes       | yes      |
| `senders.list`       | yes       | yes       | yes      |
| `senders.get`        | yes       | yes       | yes      |
| `senders.byCampaign` | no        | yes       | no       |
| `senders.warmup`     | yes       | yes       | no       |
| `leads.list`         | yes       | yes       | no       |
| `leads.byCampaign`   | yes       | yes       | yes      |
| `leads.get`          | yes       | yes       | yes      |
| `leads.since`        | client    | client    | server   |
| `leads.timeline`     | yes       | yes       | no       |
| `messages.list`      | yes       | yes       | no       |
| `messages.body`      | sampled   | full      | no       |
| `messages.since`     | server    | client    | no       |
| `replies.list`       | yes       | yes       | no       |
| `replies.category`   | vendor    | vendor    | no       |
| `replies.since`      | server    | client    | no       |
| `stats.workspace`    | exact     | exact     | exact    |
| `stats.campaign`     | exact     | exact     | exact    |
| `stats.byDay`        | exact     | exact     | exact    |
| `stats.byStep`       | exact     | exact     | no       |
| `stats.bySender`     | derived   | no        | exact    |
| `workspaces`         | yes       | yes       | no       |
| `events.parse`       | yes       | yes       | yes      |
| `events.verify`      | secret    | signature | secret   |
| `deletionDetection`  | no        | no        | no       |

The gaps that matter most:

- **HeyReach has no messages, replies or timeline.** Its API exposes messages only inside conversations, with no message id and an undocumented value for the lead's side of a thread. Guessing direction would be worse than declining, so those reads are refused. The inbox endpoints are reachable through `outbound.raw`. A `combine()` of an email tool and HeyReach therefore links a person's records across tools but shows no LinkedIn messages.
- **Instantly cannot list a campaign's mailboxes.** A campaign can attach mailboxes by tag, and the API does not expand the tag, so the list would be silently incomplete.
- **Smartlead has no per-mailbox stats** that are documented well enough to trust.
- **No adapter reveals deleted records.** Use the `reconcile` plugin's `deletions()`.

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

The live tests only read. They list campaigns and read one back, exercise each declared capability once, and check the rate budget. They run only when `LIVE_TESTS=1` and the provider's key are set, and are never part of `npm test` or CI. An adapter moves to `beta` once its fixtures are replaced by captured responses, and to `stable` once the live tests pass.
