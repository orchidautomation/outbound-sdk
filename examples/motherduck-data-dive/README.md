# motherduck-data-dive: your outbound data in DuckDB or MotherDuck

Pulls every client's campaigns, senders, leads, replies and daily stats through [outbound-sdk](https://outbound-sdk.dev) into a DuckDB database. With `MOTHERDUCK_TOKEN` set, it then copies them to [MotherDuck](https://motherduck.com) so the same SQL runs there. A second script runs a set of queries and writes `report.html`, one page with each chart's SQL underneath it.

It only reads. outbound-sdk has no method that sends, pauses, edits or deletes anything in a vendor tool. Leads are loaded without names, emails or phone numbers, because the report is about outcomes, not people.

```text
src/
├── load.ts      reads every workspace, stages JSON Lines, loads DuckDB, copies to MotherDuck
├── sources.ts   which workspaces to read: each tool whose key is set, or the demo
├── tables.ts    the warehouse tables and how SDK records become their rows
├── demo.ts      a made-up agency: four clients, one per tool, 60 days ending yesterday
└── report.ts    runs sql/report/*.sql and writes report.html
sql/
├── models.sql   views: campaign_daily, campaign_summary, campaign_change,
│                workspace_weekly, reply_mix, sender_health
└── report/      one query per section of the report
report/
└── template.html
```

## Try it without a key

You need Node 24 or later.

```sh
npm install
npm run demo
open report.html
```

`npm run demo` loads the made-up agency in `src/demo.ts` through the SDK's in-memory adapter (the same code path a live tool takes) and builds the report. Every name and number in it is invented. It is set up so the report has something to find: a campaign whose bounces jump because one sender is failing, one whose replies climb, a LinkedIn client with no bounce count at all, and one campaign that sends a lot and books almost nothing.

## Use your own tools

Set the key for each tool you use. The loader reads every tool that has a key:

| Tool | Key | Workspace label (optional) |
| --- | --- | --- |
| Instantly | `INSTANTLY_API_KEY` | `INSTANTLY_WORKSPACE_ID` |
| Smartlead | `SMARTLEAD_API_KEY` | `SMARTLEAD_WORKSPACE_ID` |
| HeyReach | `HEYREACH_API_KEY` | `HEYREACH_WORKSPACE_ID` |
| EmailBison | `EMAILBISON_API_KEY` | `EMAILBISON_WORKSPACE_ID`, plus `EMAILBISON_BASE_URL` |

```sh
npm run load               # the last 60 days
npm run load -- --days 30  # a shorter window
npm run report
```

A tool that does not offer a read, such as per-sender stats on some plans, is skipped with a note instead of failing the load. A count the tool does not report stays `NULL` in DuckDB, so a rate built on it is `NULL` too, never 0%.

## Send it to MotherDuck

```sh
export MOTHERDUCK_TOKEN=...          # from MotherDuck's settings page
export MOTHERDUCK_DATABASE=outbound  # optional; defaults to outbound_sdk
npm run load
```

The load still builds `outbound.duckdb` locally first, then copies each table to MotherDuck and creates the same views there. Open the MotherDuck UI and query `campaign_summary`, `sender_health` and the rest directly, or paste any file from `sql/report/`.

The DuckDB client is pinned to the 1.4 LTS line (`@duckdb/node-api` `1.4.5-r.1`), because MotherDuck supports a DuckDB version only once it has been released for a while.

## The tables

| Table | One row per | From |
| --- | --- | --- |
| `campaigns` | campaign | `outbound.campaigns.listAll()` |
| `senders` | mailbox or LinkedIn seat | `outbound.senders.listAll()` |
| `leads` | lead in a campaign, without personal fields | `outbound.leads.listAll()` |
| `replies` | inbound reply since the start of the window | `outbound.replies.listAll({ since })` |
| `daily_metrics` | campaign or sender per day | `outbound.stats({ scope: "campaign", by: "day" })` and `outbound.sender(id).stats({ by: "day" })` |
| `load_info` | load | whether it was the demo, and when it ran |

Every row keeps outbound-sdk's `provider`, `workspace_id` and provider-qualified `ref`, so two clients or two tools never mix. Each table is streamed to `staging/<table>.jsonl` with the SDK's `exporter` plugin and loaded with `read_json` against fixed column types, so an empty table still has the right shape.
