# Engineering guardrails

These limits are enforced by scripts and lint rules. Each check has its own test with an accepted and a rejected case. The source of the limits is Felspar's guardrails and the Linear document "Tech stack and engineering standards".

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
- Only `cli/`, `exporter/` and `fixtures/` may use Node built-ins. The rest uses web standards.
- `zod` is the only runtime dependency. A folder that needs another package declares it.
- Production code never imports a test. Tests import a folder's `index.ts` only.
- Only `internal/` may call `fetch`. The linter bans the global everywhere else in `src/`.

## Lint and format

Ultracite on Oxlint and Oxfmt, with the `core` and `anti-slop` presets (`oxlint.config.ts`). The anti-slop preset requires a `// SAFETY:` comment on every type assertion and a type predicate in place of a raw `typeof` check. The type-evidence rules are relaxed for tests only.

`oxlint-plugin-complexity` runs beside the Ultracite presets without conflict (checked 2026-11-14 with ultracite 8.2.0, oxlint 1.93.0 and the plugin at 4.1.0).

`ultracite`, `oxlint` and `oxfmt` are pinned to exact versions and are upgraded together.

## Build and size

`scripts/build.mjs` builds one ESM file per public subpath with esbuild and type declarations with `tsc`. The package's `exports` map is the only list of public subpaths. `scripts/smoke-dist.mjs` loads every subpath; CI runs it on Node 22 and Bun. `scripts/check-size.mjs` checks the minified, gzipped size of each subpath (its entry file plus the chunks it imports) against `size-budget.json`. `dist/` itself is not minified.

## Differences from the plan

- TypeScript is pinned to 6.0.3, as in Felspar. TypeScript 7 has no JavaScript compiler API, and dependency-cruiser needs that API to read TypeScript imports.
