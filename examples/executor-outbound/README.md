# executor-outbound: outbound-sdk's tools inside Executor

An [Executor](https://executor.sh) app that offers [outbound-sdk](https://outbound-sdk.dev)'s read-only agent tools over Instantly, Smartlead, HeyReach and EmailBison. Executor keeps the API keys. You call the tools with `executor call` from a shell, or from any agent connected to Executor's MCP endpoint.

Executor never hands a stored key back out, so the SDK cannot read one into `INSTANTLY_API_KEY`. It runs inside Executor instead. App code gets a handle in place of each key. Executor's network swaps in the real key only on a request to that vendor's declared host, in the declared header or query parameter.

It only reads. outbound-sdk has no method that sends, pauses, edits or deletes anything, so neither does the app.

```text
index.ts      the Executor app: one provider per vendor, one tool per outbound-sdk tool
outbound.ts   linked accounts → one outbound-sdk instance → its tools (no Executor imports)
package.json  pins the apps framework version your Executor runs
```

`outbound.ts` is also a sample on the documentation site, at `site/content/_examples/executor/outbound.ts`, where the test suite runs it. The two copies must stay byte for byte equal, and a test checks that they do.

## What is verified

On 2026-11-22 this app was deployed to a local Executor 2.0.0-beta.67 with `apps` 0.0.1-beta.143 and outbound-sdk 0.17.0. It listed 34 tools. A made-up key was linked for each vendor, and a tool call reached all four vendors, each of which answered 401. An EmailBison account on a host outside `*.emailbison.com` was refused by Executor before anything was sent. It has not been run with real keys yet.

## Deploy

You need Executor 2: `npm i -g executor@beta`, then `executor` to start it locally, or `executor login` for hosted Executor.

```sh
executor apps framework          # prints the version, e.g. 0.0.1-beta.143
```

If it prints another version, put that version in `package.json` under `dependencies.apps`. Then:

```sh
executor apps create --name "Outbound" --files .     # prints the app, with its id
executor apps source --app <app-id> | jq -r .revision.commit
executor apps deploy --app <app-id> --commit <commit>
```

Executor builds the app from the source and installs `outbound-sdk` from npm. `node_modules` is not uploaded, so run the command from a clean copy, or point `--files` at a folder holding only the three files.

Then open the app's **Accounts** tab in Executor and link an account for each tool you use. Each vendor takes any number of accounts, one per client workspace. Set **Client** to your label for that client, such as `acme`. It becomes every record's `workspaceId`.

## Use it

```sh
executor search "campaign" --namespace outbound
executor call tools.outbound.campaign_overview --input '{}'
executor call tools.outbound.sender_health --input '{}' > senders.json
```

An agent connected to Executor (`claude mcp add executor -- executor mcp`) finds the same tools with `search`.

## Change it

- **A white-labeled EmailBison URL**: add its host to `hosts` on the `emailbison` provider in `index.ts`, deploy, and reconnect the account. Until then Executor refuses to send the key there.
- **Fewer tools**: pass `only` to `createTools` and `insightTools` in `outbound.ts`.
- **Type-check**: `npm install && npm run typecheck`, with the same `apps` version Executor runs. Do not install `apps@latest`: that is an unrelated, older package.

The guide on the site walks through the same app: [Keep vendor keys in Executor](https://outbound-sdk.dev/docs/guides/executor).
