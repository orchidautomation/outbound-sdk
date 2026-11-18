# Agent eval suite

Checks the failures the 0.12.0 user tests found: wrong answers on default inputs, broken hand-offs between tools, and a "0" that means "didn't check". It lives outside the published package (`packages/outbound-sdk` ships `dist` only), and the SDK itself still calls no AI model: layer 2 is a test client that drives the MCP server through a model CLI already on the machine.

The spec is section 3 of the sharp-edges plan for OUT-145; this suite is OUT-170.

## Two layers

1. **Invariants** (`evals/run.ts`, deterministic, no model). 32 cases drive `outbound mcp --provider all` over stdio, the CLI and the SDK with fixed inputs, and assert an invariant on the raw output. Each case passes, fails or skips with a reason in counts and tool names. A failing case linked to a P1 issue makes the run **red** (exit 1). The cases also record ground truth for layer 2, such as the replies owed, the block-list violations with caps raised, or the campaigns running out of leads this week.
2. **Persona tasks** (`evals/agent/run.ts`). A model gets only the default MCP server and one persona prompt per task (7 tasks), and must end with a fixed JSON block. Each task is scored against the truth of the newest live layer-1 run at the same commit on correctness, forbidden claims (a definite answer such as `complete: true` or a count of 0 where the source said `complete: false`) and path quality: dead-end calls (`Unsupported`, `Invalid`, a JSON-RPC error, a tool not in tools/list), tool calls, vendor requests and wall time. A task scores 0-3 (correct, no forbidden claim, no dead end), or 0-2 when its correctness is unscored, and each persona gets its points over the points possible, scaled to 3. Forbidden claims are decided by fixed rules only; no model judge runs yet. Task 2 (client-call prep) covers the whole workspace rather than one tag, so its truth comes from the same `client_report` call as case 9 and costs no second report. A task is left unscored ("no truth") rather than scored against a guess: when its case has no truth at that commit, when the report did not check every campaign (tasks 2 and 4), when a tool has no workspace totals (task 5), or when no link between an email and a LinkedIn person was observed and the tools carry a shared identifier type (task 7). Task 3 is still scored over an incomplete check, because its truth is then a lower bound: at least the violations found, with `complete: false`.

## Commands

| Command | Runs |
| --- | --- |
| `npm run eval` | Layer 1 offline: fixtures replayed through injected fetch, on a virtual clock fixed at 2026-11-18 12:00 UTC. About a second, no network, no keys. |
| `LIVE_TESTS=1 npm run eval` | Layer 1 live against every provider whose key is set, read-only. Writes `~/outbound-evals/<stamp>.invariants.{json,md}`. |
| `npm run eval:agent` | Layer 2 live with `claude -p` (model `sonnet` unless `--model` names another). Writes `~/outbound-evals/<stamp>.agent.{json,md}`. Run layer 1 live first on the same checkout: tasks are scored on the newest run at that commit from the last 24 hours, never on another commit's. |
| `evals/nightly.sh` | Both layers live, then the two summaries as one comment on OUT-145. `EVAL_POST=0` skips the comment. |
| `npm test` | Includes `evals/test/`: every judge with an accepted and a rejected case, and the whole offline suite held to `evals/offline-expected.json`. |

Flags: `--cases 1,4,9` and `--tasks 1,4` pick cases or tasks; `--max-requests N` sets the run's vendor request budget (default 4,000); `--out <dir>` writes results elsewhere; `--checkout <path>` runs another worktree's CLI and MCP server (see below).

When a fix or a regression changes an offline verdict, `npm test` fails on `offline-expected.json`. Record the new verdicts with `UPDATE_EVALS=1 npm test` and read the diff before committing. Offline verdicts reflect the fixtures as much as the code: cases 3-5 skip offline because no fixture conversation is dropped, and case 27 fails offline because the fixtures' daily rows are not one coherent workspace.

## Guard rails

- **Read-only by construction.** The SDK has only read methods, and the suite calls nothing else.
- **One run at a time.** Live layer 1, layer 2 and `nightly.sh` share a lock in `~/outbound-evals/.lock` and exit 75 while another run holds it. Concurrent runs on Instantly's email lane slow every call.
- **A request budget per run.** Every MCP, CLI and SDK read spends from one budget. Once it is spent, the remaining cases skip with that reason. The cheap P1 cases run first. The first live run spent about 3,800 requests over 32 cases in 12 minutes, of which about 1,300 went to case 6 (every tool at its defaults) and 800 and 560 to the two capped safety checks.
- **Nothing stored on our side.** Results stay on the machine that ran them. The markdown summary, which is the only thing posted, is refused before writing or posting if it matches an email address, a LinkedIn or other URL, a redact token or a vendor id (`evals/report.ts`). The JSON keeps counts and campaign refs, never a person.
- **Default configuration.** Live, the server is exactly `outbound mcp --provider all`: redact on, no key, a 50 s time budget. Cases 21 and 22 read with `--no-redact` because the person tools need real identifiers, and they keep only counts. Offline, each call gets a 3,600 s budget on the virtual clock so the fixtures are read in full. Case 19 sets its own 60 s budget.

## Before and after a branch (OUT-168)

To compare a branch with main, run both layers against each worktree from one checkout that has this folder, and compare the two agent summaries. Each one shows the change in tool calls and dead ends per task since the previous run:

```sh
LIVE_TESTS=1 npm run eval -- --checkout ../main-worktree && npm run eval:agent -- --checkout ../main-worktree
LIVE_TESTS=1 npm run eval -- --checkout ../branch-worktree && npm run eval:agent -- --checkout ../branch-worktree
```

`--checkout` points the live server and CLI at `<path>/packages/outbound-sdk/src/cli/bin.ts`. The cases and tasks stay this checkout's, so both sides are measured by the same suite. Run the two sides back to back, because the workspaces change overnight.

## Scheduling on Brandon's Mac (not installed)

`evals/launchd/dev.outbound-sdk.evals.plist` runs `evals/nightly.sh` at 03:00 on the Mac's clock (America/New_York). `nightly.sh` runs under `zsh -i`, so it reads `INSTANTLY_API_KEY`, `HEYREACH_API_KEY` and `LINEAR_API_KEY` from `~/.zshrc` and never prints them. To install it, from this checkout:

```sh
sed "s#REPO#$(pwd)#g" evals/launchd/dev.outbound-sdk.evals.plist > ~/Library/LaunchAgents/dev.outbound-sdk.evals.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.outbound-sdk.evals.plist
launchctl kickstart gui/$(id -u)/dev.outbound-sdk.evals   # optional: run once now
```

The run logs to `/tmp/outbound-evals.log`. To remove it: `launchctl bootout gui/$(id -u)/dev.outbound-sdk.evals`, then delete the plist. launchd runs a missed job when the Mac wakes, but not when it was off or offline at 03:00.

Use a checkout that stays on `main` and is updated before each run (for example `git -C <checkout> pull --ff-only` at the top of a wrapper). A task branch would evaluate whatever it has checked out.

## Before each publish

Run `EVAL_POST=0 evals/nightly.sh` on the release commit and read both summaries. A red layer 1 blocks the release until each failing P1 case is fixed or explicitly accepted. Then post the summaries to the release issue with `node evals/post.ts --issue OUT-<n> <files>`.

## Layout

| Path | Holds |
| --- | --- |
| `run.ts`, `suite.ts` | Layer 1 entry point and case order |
| `cases/` | The 32 cases, each with an exported pure judge |
| `context.ts`, `session.ts`, `transport.ts`, `clock.ts` | The MCP client, the CLI and SDK surfaces, offline fixtures and the virtual clock |
| `agent/` | Layer 2: tasks and scoring, the runner, and a logging MCP proxy that records each call's name, code, cost and completeness, never its content |
| `report.ts`, `post.ts`, `lock.ts` | Summaries and the personal-data guard, the Linear comment, the run lock |
| `launchd/`, `nightly.sh` | The schedule |
