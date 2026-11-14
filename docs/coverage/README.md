# Coverage

One file per vendor lists every endpoint in that vendor's public API reference and says how the SDK reaches it. The rule: nothing a vendor can report about campaigns, leads, senders or results is dropped. A read is either normalized, or it is in the adapter's native catalog and returned as the vendor sent it.

`npm test` checks each file against the adapter (`test/coverage-docs.test.ts`), so a table cannot drift from the code.

## The table

Each file has exactly one table with these columns, one row per endpoint:

| Column   | Holds                                                    |
| -------- | -------------------------------------------------------- |
| Method   | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`                |
| Path     | The vendor's path, with `{name}` for each path parameter |
| Reads    | What the endpoint returns, in a few words                |
| Coverage | `normalized`, `native`, `excluded` or `write`            |
| Through  | See below                                                |

What `Through` holds depends on `Coverage`:

- `normalized`: the SDK read or reads that use the endpoint, by capability key (`campaigns.settings`, `stats.byDay`), separated by commas. `campaigns.list` and `campaigns.get` are also accepted.
- `native`: the name of the read in the adapter's native catalog. Its method and path must match the row.
- `excluded`: the reason it is left out, in one sentence. Only three reasons are accepted: the endpoint returns secrets, it duplicates another row's data exactly, or it reports nothing about campaigns, leads, senders or results (billing, team members, API keys).
- `write`: left empty. The SDK is read-only; writes are listed so the inventory is complete.
