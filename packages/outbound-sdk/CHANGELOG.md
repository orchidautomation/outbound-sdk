# outbound-sdk

## 0.2.0

### Minor Changes

- adf0104: `fromEnv({ provider: "all" })`, `OUTBOUND_SDK_PROVIDER=all` and `outbound --provider all` build every provider whose key is set in the environment: one adapter alone, or several behind one combined instance. Setting another vendor's key adds that tool with no code change. `outbound-sdk/loader` also exports `configuredProviders()` and `ALL_PROVIDERS`.
- 68e2827: `outbound mcp` now masks personal data by default: it runs with `redact()` unless started with `--no-redact`. Every command takes `--config <file>` to load plugins from a file (`defineConfig` from `outbound-sdk/cli`), `--cache <seconds>`, `--max-requests <n>` and `--redact`. The MCP server's `instructions` name the plugins that are on, and a `budget({ per: "run" })` on the instance is reset before each tool call, so its cap is per tool call. `serveStdio(server)` serves a server you build on standard input and output.
- 97e7366: With no provider named, the CLI, `outbound mcp` and `fromEnv()` do the same as `all`: every vendor whose key is set, as one combined instance, so a person is found across Instantly and HeyReach with nothing to configure. A named provider still picks one vendor. New `outbound person <email or LinkedIn URL>`. The CLI installs the identity plugin, so `cross_channel_lead` is served and leads carry `personKey`; `outbound tools` and `outbound tool` now offer the insights, as `outbound mcp` does. `person_summary` now refuses with `Unsupported` while `redact` masks emails or LinkedIn profiles, instead of reporting a known person as not found; with redact off, the MCP server's instructions still say that personal fields are not masked.

### Patch Changes

- 3bd7573: Reads that do not depend on each other now run side by side. A person lookup on a combined instance (a lead listing filtered by `email` or `linkedinUrl`) asks every tool at once, and `person_summary`, `identity`'s `person()` and the insights that read per campaign or per sender keep a few reads in flight instead of one. Answers, their order and their request counts are unchanged; every request still fits its vendor's rate budget.

  A `budget({ per: "run" })` cap now counts each request as it is sent, so calls running at the same time can no longer go past it together.

## 0.1.0

### Minor Changes

- 2c1f7a8: Draw cards in Slack with its newer blocks. `toSlackBlocks` and `toSlackMessage` now default to a `rich` style: numbers as a bordered grid of tiles, a short list of leads or replies as cards side by side, data table cells that sort as numbers, and a primary button. `style: "plain"` writes what Chat SDK's Slack adapter writes, as before. `alertCard` shows a rate as a percentage, and the bounce section of a digest no longer repeats its headline.
- b6037e5: Add `outbound-sdk/cards`: every tool and insight answer as a card. A card is a json-render spec for the chat catalog, built from the numbers the tool returned, with `toSlackMessage` to post it to Slack with no other package, `digest` for one message made of several results, and `eventCard` and `alertCard` for webhook events and alerts. `outbound tool` and `outbound insight` take `--card` and `--slack`.
- 10aedb7: First release: the core client, the request engine, adapters for Instantly, Smartlead and HeyReach with a typed native catalog of each vendor's own reads, fifteen plugins, webhooks, 26 computed insights, AI tools, the `outbound` CLI and a local MCP server. HeyReach and Instantly are `beta`; Smartlead is `unverified` until it has been checked against live credentials.
