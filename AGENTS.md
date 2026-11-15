# outbound-sdk

One small, typed, read-only TypeScript API over outbound sending tools. MIT, open source.

## Product boundary

- Read-only. No method sends, pauses, edits or deletes anything in a vendor tool.
- Stores nothing on our side. A plugin that keeps state takes a store the user supplies.
- Calls no AI model. Reply categories come from the vendor or from fixed rules.
- Every record carries `provider`, `workspaceId` and a provider-qualified `ref`.
- A missing count is `null`, never `0`. An unsupported call throws `Unsupported` before any HTTP request.

## Where things are

| Path | Holds |
| --- | --- |
| `packages/outbound-sdk/src/index.ts` | Thin facade: `createOutbound`, public types |
| `packages/outbound-sdk/src/internal/` | Request engine, errors, capability gating, schemas |
| `packages/outbound-sdk/src/<provider>/` | One adapter: `client.ts`, `map.ts`, `capabilities.ts`, `webhooks.ts` |
| `packages/outbound-sdk/src/<plugin>/` | One plugin per folder |
| `packages/outbound-sdk/test/` | Tests, through entry points only |
| `fixtures/<provider>/` | Documented vendor payloads with personal data removed |
| `scripts/` | Guardrail checks, each with its own test |
| `docs/` | For contributors: architecture, guardrails, adding an adapter, per-vendor research |
| `site/` | The public documentation site (Blume), deployed to outbound-sdk.dev. `docs/site.md` says how to change and publish it |
| `site/content/_examples/` | Every code sample the site shows. `npm test` runs each one |
| `skills/` | Agent skills for SDK users. `npm test` runs their samples and commands; `skills/README.md` says how |
| `examples/` | Standalone apps built on the published package, each with its own `package.json`. Not in the workspace and not run by `npm test` |

The design authority is the Outbound SDK spec and the Linear document "Tech stack and engineering standards", both linked from the Linear project `Outbound SDK` (team `OUT`).

## Commands

| Command | Runs |
| --- | --- |
| `npm run check:fast` | lint, type check, architecture, repo shape, `git diff --check` |
| `npm run check` | `check:fast`, tests, build, dist smoke test, size budget |
| `npm run check:changed` | only the checks a change touches |
| `npm run fix` | formatter and lint autofixes (run it twice) |
| `npm run test:live` | read-only checks against real keys; needs `LIVE_TESTS=1` |

Node is pinned in `.node-version`. Install with `npm ci`.

## Rules

- Work on a task branch. Never push to `main`, never merge, never enable auto-merge. Brandon merges.
- Link every pull request to its `OUT-` issue.
- A merged pull request is not a release. Do not call anything shipped without the published package.
- Only `src/internal/` may call `fetch`. Adapters use `ctx.request()` so nothing bypasses the rate budget.
- An adapter imports `internal/` and nothing else. Declare a new folder in `scripts/architecture-rules.mjs`.
- Tests import a folder's `index.ts`, mock at the network boundary by injecting `fetch`, and never mock modules.
- Fixtures contain no real names, emails or keys. `npm test` rejects anything that looks real.
- Suppress a lint rule only inline with a reason: `// oxlint-disable-next-line <rule> -- <why>`.
- Every mechanical check ships with a test proving an accepted and a rejected case.
- Size limits are in `docs/engineering-guardrails.md`. Split by responsibility; never minify to pass.
- Vendor facts come from that vendor's current documentation, fetched fresh. Record the URLs and the date in `docs/research/<provider>.md` before changing an adapter.
- A page on the site carries no code of its own. A sample is a file under `site/content/_examples/`, spliced in with `<include>`; record its output with `UPDATE_EXAMPLES=1 npm test` and read it before committing.
- The site says only what is true today: what `site/content/docs/status.mdx` records as verified, and no install command while the package is unpublished. `site/test/site-truth.test.ts` holds it to the code.
- Each fact has one home. Link between Linear and this repository instead of copying text.
- The vendor-drift agent may edit one vendor's `map*.ts`, `capabilities.ts`, `webhooks.ts`, tests, fixtures and research note, and nothing else. `scripts/check-drift-scope.mjs` enforces it.

## Adding or changing an adapter

Follow the numbered checklist in `docs/new-adapter.md`.
