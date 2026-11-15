# Adding an adapter

An adapter is thin. It describes each request and maps the response. It never retries, sleeps, walks pages or throws for an unsupported feature; the wrapper does all of that. Model a new adapter on `packages/outbound-sdk/src/instantly/`.

## Checklist

1. **Research first.** Fetch the vendor's current API reference, rate-limit page, webhook page and changelog. Prefer machine-readable copies (`llms.txt`, Markdown pages, OpenAPI). Never work from memory or a saved copy. Write `docs/research/<provider>.md` with what you found, every URL you read and the date, and a section listing what the documentation leaves unclear.
2. **Save documented payloads** as `fixtures/<provider>/<operation>.json`, one per endpoint and webhook event, with a `.page2.json` for the last page of each list. Replace personal data with obvious fakes: `person1@example.com`, "Alex Example", "Example Co", `https://www.linkedin.com/in/example-person-1`. List any payload built from a schema rather than copied from an example in `fixtures/<provider>/SYNTHESIZED.md`. `npm run fixtures` rejects real-looking emails, LinkedIn profiles and credentials.
3. **Declare the folder** in `scripts/architecture-rules.mjs` (`adapters`). An adapter may import `internal/` and nothing else.
4. **Write `capabilities.ts`:** the capability map, the rate limits with their source URL, request costs, caveats and `fields`. Declare only what the documentation supports. Anything you leave out reads as unsupported. Put every assumption the documentation does not confirm in `caveats`. Declare `costs` for every read the adapter serves: insights and tool calls work out their default request cap and the check before their first request from them, and an insight with a read that has no cost gets neither. Each entry is `{ perPage, pageSize?, perRecord?, perWalk?, perPageAtMost? }`. `perPage` is the usual requests per page or lookup. Add `perWalk` for extra requests a listing makes once (a category list read with the first page, an empty last page the vendor always sends) and `perPageAtMost` when some pages cost more than others (a label lookup only some pages need). Both count only in the upper bound, so declare the most they can be; `test/insights/costs.test.ts` holds every insight to these numbers and checks each default cap at default inputs stays under 500: add the adapter to its list of vendors. In `fields`, list the fields of each record this vendor never fills (`false`) and the ones the adapter works out (`"derived"`), or `false` for a record it never returns. A field you say nothing about is one the vendor reports.
5. **Write `client.ts`:** base URL, how the credential is attached, and `isRead`, which says which requests only read (some vendors list with POST). Every request goes through `ctx.request()`; the linter bans `fetch` here.
6. **Write `map.ts`:** pure functions from vendor payloads to entities. Read with the helpers in `internal/json.ts`. Lowercase emails, convert times to ISO 8601 UTC, map enums and leave an unmapped value as `unknown` with the original in `raw`. Read counts, never rates. A count the vendor does not report is `null`, never `0`. Use what is already shared before writing your own: `metricRow` in `internal/metrics.ts` for a stats row, `toVariant`, `variantKey` and `fromOne` in `internal/sequence.ts` for sequences and step numbers, `mapPage` in `internal/page.ts` to turn a vendor page into records, `requireObject` in `internal/errors.ts` for a response that must be one object, `listIn` in `internal/lists.ts` for a list answer (a body that is not the documented list is a `Provider` error, never an empty page; record why in a code comment for any read you leave lenient), and the `inQuery`, `inBody` and `inPath` builders in `internal/native.ts` for the native catalog.
7. **Write `webhooks.ts`:** `detect`, `parse` and, when the vendor signs payloads, `verify`. An event the adapter does not know becomes `type: "unknown"` with `raw` kept.
8. **Write `adapter.ts` and `index.ts`:** the read methods (one page per call) and the factory. Read the API key from the option, then from `<PROVIDER>_API_KEY`. Export `envVars`.
9. **Register it:** add the subpath to `exports` in `packages/outbound-sdk/package.json`, an entry in `src/providers/index.ts`, a loader in `src/loader/index.ts`, and a budget in `size-budget.json` if it needs more than the default.
10. **Test it:** create `packages/outbound-sdk/test/<provider>.test.ts`, describe the routes to your fixtures and call `runAdapterSuite()`. Then add tests for what is specific to this vendor, with expected values taken from the documented payloads. Where a documented example repeats one number across fields, add a test with a distinct value per field.
11. **Run `npm run check`.** It must pass before the pull request is opened.

## What the shared suite checks

For every adapter, offline, from the fixtures:

- Each listing returns every record across pages with no duplicates, and every record carries the provider, the workspace, a matching ref, a lowercased email and ISO timestamps.
- Each declared capability returns data, and each undeclared one is refused as `Unsupported` before any request leaves.
- Each field the adapter declares `false` is empty in every record the fixtures produce, and every other field is filled in at least one. A field the adapter fills that no default fixture shows goes in the suite's `unsampled`, with the reason.
- Every request is authorized, goes to the vendor's origin and is a declared read.
- Only endpoints with a fixture are called.
- Vendor errors map to the right code and never contain the API key.
- Each webhook fixture parses to the expected event type, matches the event schema and gets the same id when delivered twice. An unknown event is kept as `unknown`.

## Maturity

An adapter starts as `unverified`: written from documentation and tested offline. It becomes `beta` once its reads have been run against a live account and the differences fixed, and `stable` once its fixtures are captured responses and the live tests pass on a schedule.
