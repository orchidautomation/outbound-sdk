---
name: outbound-sdk-setup
description: Set up outbound-sdk in a project and connect it to an agent, either by installing the package, choosing a vendor adapter (Instantly, Smartlead, HeyReach or the in-memory demo) and its API key, running `outbound mcp` as a local MCP server for Claude Code, Cursor or Claude Desktop, with plugins from flags or a config file, or by building your own MCP server. Use when someone wants an agent or a script to read their outbound campaigns, or when the `outbound` MCP server or CLI is not starting.
---

# Setting up outbound-sdk and its MCP server

outbound-sdk is a read-only TypeScript SDK over Instantly, Smartlead and HeyReach. `outbound mcp` serves its tools to an agent client over stdio. It stores nothing and calls no model, and the vendor key stays in the environment of the process the client starts.

Before you start, confirm what the user has. Do not assume a published package or a working key.

## 1. Install it

**The package is not on npm.** `npm install outbound-sdk` does not install it, and `npx outbound-sdk …` does not work, because the package has not been published. Check [installation](https://outbound-sdk.dev/docs/installation) for the current state before saying otherwise. Until it says the package is published, install the tarball attached to the GitHub release, by URL. It needs no clone and no build:

```sh
npm install https://github.com/orchidautomation/outbound-sdk/releases/download/v0.1.0/outbound-sdk-0.1.0.tgz
```

If that URL fails (no network to GitHub, or the user wants to build from source), build the tarball from a clone of the repository, which is public (https://github.com/orchidautomation/outbound-sdk):

```sh
# needs Node 24.15 or later to build
git clone https://github.com/orchidautomation/outbound-sdk.git
cd outbound-sdk
npm ci
npm run build
cd packages/outbound-sdk && npm pack   # writes outbound-sdk-0.1.0.tgz

# in the user's project (the built package runs on Node 22 or later)
npm install /absolute/path/to/outbound-sdk-0.1.0.tgz
```

The package is ESM only. In a project without `"type": "module"`, name TypeScript files `.mts`.

If neither works (no access to GitHub, and no Node 24.15 or later or no git to build), say so and stop: there is no other install until the package is published.

## 2. Pick the adapter and the key

Try it on demo data first, with no key and no network:

```sh
npx outbound providers
OUTBOUND_SDK_PROVIDER=memory npx outbound capabilities
OUTBOUND_SDK_PROVIDER=memory npx outbound tool sender_health --input '{"limit":1}'
```

`providers` lists each adapter with its maturity and the variables it reads, and needs no adapter. `capabilities` prints what the chosen adapter can read, plus its maturity and caveats, without making a request.

| `OUTBOUND_SDK_PROVIDER` | Key variable | Maturity |
| --- | --- | --- |
| `instantly` | `INSTANTLY_API_KEY`, an API V2 key; `all:read` is enough | `beta`: run once, read-only, on one live workspace |
| `heyreach` | `HEYREACH_API_KEY` | `beta`: run once, read-only, on one live workspace |
| `smartlead` | `SMARTLEAD_API_KEY` | `unverified`: never run against a live account |
| `memory` | none | demo data, no vendor behind it |
| `all` | every key above that is set | one combined instance over those vendors; `memory` is never included |

Tell the user what the maturity means for their vendor: `unverified` means expect mappings to be wrong. [What is verified](https://outbound-sdk.dev/docs/status) is the current record.

**Use a read-only key** where the vendor offers one. No method of the SDK writes, and a key that cannot write makes that true of the credential too. The key is read inside the server process. It never appears in a tool input or result, and it is removed from error messages.

## 3. Connect an MCP client

The package is not published, so the client cannot fetch it with `npx`. Point the client at the installed file, by absolute path, because a client may not start the command in the project folder. In Claude Code:

```sh
claude mcp add outbound --env OUTBOUND_SDK_PROVIDER=memory -- node /absolute/path/to/project/node_modules/outbound-sdk/dist/cli/bin.js mcp
claude mcp get outbound
```

Swap `memory` for the user's vendor and add its key with another `--env`, once the demo works. `claude mcp add` stores the server, key included, in the user's local Claude Code configuration. With `--scope project` it is written to `.mcp.json` in the project instead, which is a file that may get committed: keep keys out of it. Cursor (`.cursor/mcp.json`) and Claude Desktop (`claude_desktop_config.json`) take the same `command`, `args` and `env`. The [MCP server guide](https://outbound-sdk.dev/docs/guides/mcp-server) has the JSON form.

On 2026-11-14 a tarball install was checked this way: Claude Code 2.1.325 reported the server as connected, and it answered `initialize` with 35 tools on `memory`. No model was run against it.

To check the server without a client, send it a line on standard input:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | OUTBOUND_SDK_PROVIDER=memory node node_modules/outbound-sdk/dist/cli/bin.js mcp
```

It answers `{"id":1,"jsonrpc":"2.0","result":{}}` and exits when its input closes.

## 4. Plugins

**`outbound mcp` masks personal data by default.** It runs with `redact()`, so emails, names, companies and message text come back masked, reply text is refused, and `cross_channel_lead` is not offered. Tell the user before turning it off. Turn it off only when the agent needs reply text or the person lookup, by adding `--no-redact` to the client's `args`.

Three flags cover the usual needs. Add them after `mcp` in `args`:

| Flag | Adds |
| --- | --- |
| `--no-redact` | Nothing: turns the default `redact()` off |
| `--cache <seconds>` | `cache()`: a repeat read within that time makes no vendor request |
| `--max-requests <n>` | `budget()`: the most vendor requests one tool call may make |

For any other plugin, or plugin options, use a config file: [examples/outbound.config.ts](examples/outbound.config.ts) is one, and [examples/check.ts](examples/check.ts) ends by starting `outbound mcp --config` on it. Copy it into the project as `outbound.config.mjs` and add `--config /absolute/path/to/outbound.config.mjs` to `args`. Its default export lists the plugins, and `redact()` is put in front of them unless the list has its own.

A `.mjs` or `.js` file works on every supported Node. A `.ts` file needs a Node version that runs TypeScript files directly. The server's `instructions` name the plugins that are on. Plugins and their order are on the [plugins](https://outbound-sdk.dev/docs/plugins) page.

With keys for several vendors set and no `OUTBOUND_SDK_PROVIDER`, `outbound mcp` serves all of them as one instance; `--no-redact` then lets the agent look one person up across them.

**A server of your own** is for when you want to build the instance in code: [examples/server.ts](examples/server.ts) picks the adapter from `OUTBOUND_SDK_PROVIDER`, as `outbound mcp` does, adds `redact()`, and serves stdio with `serveStdio`.

- Copy it into the project as `server.mts` (or `server.ts` in a `"type": "module"` project) and point the client at `node /absolute/path/to/server.mts`. Node 24 runs it as is.
- [examples/check.ts](examples/check.ts) feeds it a `ping`, a `tools/list` and a call for reply text, which `redact()` refuses. [examples/check.out.txt](examples/check.out.txt) is what it printed.

## 5. Tools in code, not over MCP

For an agent you build yourself, hand it the tools directly. Each wrapper takes the instance and the same `only` and `extra` options. Fetch the page for the one you use; do not write the wiring from memory:

- [OpenAI](https://outbound-sdk.dev/docs/tools/openai): `openaiTools` from `outbound-sdk/tools`
- [AI SDK](https://outbound-sdk.dev/docs/tools/ai-sdk): `aiSdkTools` from `outbound-sdk/tools/ai-sdk`, which needs `ai` 6 or 7
- [Claude Agent SDK](https://outbound-sdk.dev/docs/tools/claude-agent): `claudeAgentTools` from `outbound-sdk/tools/claude-agent`, which needs `@anthropic-ai/claude-agent-sdk`

Add the insights with `extra: insightTools(outbound)` from `outbound-sdk/insights`. Pass `maxRequests` to `createOutbound` to cap what one call may spend against the vendor's rate limit; `outbound mcp` sets a cap only with `--max-requests`.

## When it does not start

| What you see | Cause | Fix |
| --- | --- | --- |
| `Invalid: No provider key is set. Set at least one of: INSTANTLY_API_KEY, SMARTLEAD_API_KEY, HEYREACH_API_KEY, …`, exit 1 | Neither a key nor `OUTBOUND_SDK_PROVIDER` is set in the environment the client starts | Add the key to the client's `env` |
| `Unauthorized: instantly needs an API key: pass apiKey or set INSTANTLY_API_KEY`, exit 1 | The adapter's key is missing (the message names your vendor's variable) | Add the key to `env`, or set it where the client inherits it |
| `Cannot use import statement outside a module` | A `.ts` file in a CommonJS project | Rename it `.mts`, or set `"type": "module"` |
| `npm error 404` for `outbound-sdk` | The package is not published | Install the tarball (step 1) |
| Tools are missing from the list | The adapter cannot serve them, or a plugin turned them off | Expected. Run `npx outbound capabilities` to see what is declared |

[Troubleshooting](https://outbound-sdk.dev/docs/troubleshooting) has the rest, with the exact messages.

Once it runs, the `outbound-sdk-answering` skill covers how to ask the tools and how to report what they return.
