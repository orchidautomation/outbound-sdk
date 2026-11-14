# Adapters

Three adapters ship today. Each was written from the vendor's public API documentation read on 2026-11-14 and tested offline against documented payloads.

- **HeyReach is `beta`:** its reads were run once, read-only, against one live workspace on 2026-11-14, which fixed two things the documentation got wrong or left out.
- **Instantly and Smartlead are `unverified`:** neither has been run against a live account.

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
| `leads.timeline`     | yes       | yes       | yes      |
| `messages.list`      | yes       | yes       | yes      |
| `messages.body`      | sampled   | full      | full     |
| `messages.since`     | server    | client    | client   |
| `replies.list`       | yes       | yes       | yes      |
| `replies.category`   | vendor    | vendor    | no       |
| `replies.since`      | server    | client    | client   |
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

- **HeyReach replies carry no category.** Its auto-tags describe the lead, not a message, so a reply cannot be filtered by category. Messages, replies and a lead's timeline are read from conversations; a message has no id in HeyReach, so the SDK builds a stable one.
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

The live tests only read. They list campaigns and read one back, exercise each declared capability once, and check the rate budget. They run only when `LIVE_TESTS=1` and the provider's key are set, and are never part of `npm test` or CI. An adapter moves to `beta` once its reads have been run against a live account, and to `stable` once its fixtures are captured responses and the live tests pass on a schedule.
