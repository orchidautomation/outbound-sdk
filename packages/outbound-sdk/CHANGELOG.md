# outbound-sdk

## 0.1.0

### Minor Changes

- 2c1f7a8: Draw cards in Slack with its newer blocks. `toSlackBlocks` and `toSlackMessage` now default to a `rich` style: numbers as a bordered grid of tiles, a short list of leads or replies as cards side by side, data table cells that sort as numbers, and a primary button. `style: "plain"` writes what Chat SDK's Slack adapter writes, as before. `alertCard` shows a rate as a percentage, and the bounce section of a digest no longer repeats its headline.
- b6037e5: Add `outbound-sdk/cards`: every tool and insight answer as a card. A card is a json-render spec for the chat catalog, built from the numbers the tool returned, with `toSlackMessage` to post it to Slack with no other package, `digest` for one message made of several results, and `eventCard` and `alertCard` for webhook events and alerts. `outbound tool` and `outbound insight` take `--card` and `--slack`.
- 10aedb7: First release: the core client, the request engine, adapters for Instantly, Smartlead and HeyReach with a typed native catalog of each vendor's own reads, fifteen plugins, webhooks, 26 computed insights, AI tools, the `outbound` CLI and a local MCP server. HeyReach and Instantly are `beta`; Smartlead is `unverified` until it has been checked against live credentials.
