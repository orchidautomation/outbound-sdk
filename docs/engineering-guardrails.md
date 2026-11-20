# Engineering guardrails

These limits are enforced by scripts and lint rules. Each check has its own test with an accepted and a rejected case.

## File and function size

`scripts/check-repo-shape.mjs` enforces file limits. The linter enforces function limits. Passing the review threshold is a warning. Passing the hard limit fails the check.

| Surface | Review threshold | Hard limit |
| --- | --- | --- |
| Root `AGENTS.md` | 80 lines | 120 lines and 12 KiB |
| Nested `AGENTS.md` | 100 lines | 150 lines and 16 KiB |
| `SKILL.md` | 200 lines | 300 lines |
| Module facade (`index.ts`) | 150 lines | 250 lines |
| Handwritten source | 400 lines | 600 lines |
| Test source | 600 lines | 900 lines |
| Declarative files and fixtures | 800 lines | 1,200 lines |
| Other authored text | 800 lines | 1,200 lines |
| Function length | n/a | 100 lines (`max-lines-per-function`) |
| Cognitive complexity | n/a | 25 (`oxlint-plugin-complexity`) |
| Any tracked file | n/a | 1 MiB |

Generated source and lockfiles are exempt from line limits. Split by responsibility; do not minify or split arbitrarily to pass.

A recorded vendor payload that must exceed 1,200 lines needs an entry with a reason in `fixtures/large-fixtures.json`. Trim the payload to the fields under test first.

## Repository hygiene

The shape check rejects tracked `.env` files, operating-system metadata and local agent state such as `.agent-artifacts/`, even when force-added.

## Architecture

`scripts/check-architecture.mjs` runs dependency-cruiser over resolved imports with the rules in `scripts/architecture-rules.mjs`.

- An adapter may import `internal/` and nothing else, never another adapter.
- Every folder under `src/` is declared with the folders it may import. An undeclared folder fails.
- No import cycles and no unresolved imports.
- Only `cli/`, `exporter/` and `fixtures/` may use Node built-ins. The rest uses web standards. The rule covers `node:` and bare specifiers, static and dynamic imports, and any folder not listed as a Node folder, so a new adapter is covered without being named.
- `zod` is the only runtime dependency. A folder that needs another package declares it.
- Production code never imports a test. Tests import a folder's `index.ts` only.
- Only `internal/` may call `fetch`. The linter bans the global everywhere else in `src/`.

## Workers runtime

`scripts/workers-tests.mjs` (`npm run test:workers`, its own CI job) runs the package's tests inside Cloudflare's Workers runtime through Miniflare. Nothing lists which tests run: esbuild bundles every test file, and a file is left out only when what it imports reaches a Node built-in or a Node folder. The run prints each file it leaves out and why. The fixtures helper is swapped for the same fixtures embedded in the bundle, `node:test` for a small stand-in, and `node:assert` is the runtime's own from `nodejs_compat`. Before any SDK code loads, the Worker removes the globals `nodejs_compat` adds (`Buffer`, `global`, and `process` apart from an empty `env`), because a Worker without that flag has none of them. Every public subpath outside the Node folders must load, and every Workers-safe folder must be reached by something that runs, so a new adapter is checked as soon as it is declared. `miniflare` is a dev dependency only, pinned exactly; it is the runtime `@cloudflare/vitest-pool-workers` uses, without moving the tests to Vitest.

## Lint and format

Ultracite on Oxlint and Oxfmt, with the `core` and `anti-slop` presets (`oxlint.config.ts`). The anti-slop preset requires a `// SAFETY:` comment on every type assertion and a type predicate in place of a raw `typeof` check. The type-evidence rules are relaxed for tests only.

`oxlint-plugin-complexity` runs beside the Ultracite presets without conflict (checked 2026-11-14 with ultracite 8.2.0, oxlint 1.93.0 and the plugin at 4.1.0).

`ultracite`, `oxlint` and `oxfmt` are pinned to exact versions and are upgraded together.

## Build

`scripts/build.mjs` builds one ESM file per public subpath with esbuild and type declarations with `tsc`. The package's `exports` map is the only list of public subpaths. `scripts/smoke-dist.mjs` loads every subpath; CI runs it on Node 22 and Bun. There is no bundle size budget. `scripts/check-size.mjs` and `size-budget.json` were removed on 2026-11-15 at Brandon's request, after the budgets had to be raised twice that day (OUT-50) to make room for fixes. `dist/` itself is not minified.

## Generated source

`packages/outbound-sdk/src/insights/inputs.generated.ts` holds the input type of every built-in insight, with each field's description, default and range as JSDoc, read from the insight's Zod schema. After changing an insight's input, run `node scripts/generate-insight-inputs.mjs`. `npm test` fails while the file is stale, and the type check fails if a generated input stops matching its schema.

## Insight names

Insight inputs and answers follow one naming rule, written on the site under [Names](../site/content/docs/insights/index.mdx#names): snake case inputs and camel case answers, `from`/`to` as a day range, `limit` against `max_*`, `campaign` always a ref beside `campaignName`, and one rate shape. Built-in tools follow the same rule: snake case inputs, camel case answers, and every record they return carries `provider`, `workspaceId` and its ref (`packages/outbound-sdk/test/record-provenance.test.ts` holds them and the CLI listings to it). To rename an input, keep the old name for one minor release with `renamed()` from `packages/outbound-sdk/src/internal/renamed.ts`: it moves the old value to the new name before parsing and adds a deprecation note. Rename an answer field by adding the new one and marking the old one `@deprecated` until the release that removes it. The one exception is OUT-166, which renamed the built-in tools' answers to camel case outright in 0.16.0, as a breaking change its changeset names.

## Differences from the plan

- TypeScript is pinned to 6.0.3. TypeScript 7 has no JavaScript compiler API, and dependency-cruiser needs that API to read TypeScript imports.
