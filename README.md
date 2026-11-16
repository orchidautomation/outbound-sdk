<img src="assets/icon.svg" width="64" height="64" alt="">

# outbound-sdk

One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead, HeyReach and EmailBison. What they share is normalized; everything else each one can report is still there through a typed native catalog, so nothing readable is dropped. It never writes to a vendor tool, stores nothing and calls no AI model.

```ts
import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const outbound = createOutbound({ adapter: instantly() });
for await (const campaign of outbound.campaigns.listAll({ status: "active" })) {
  console.log(campaign.name, campaign.ref);
}
```

> Status: a 0.x preview on npm (`npm install outbound-sdk`). HeyReach and Instantly are `beta` (their reads were run against a live workspace each). Smartlead ships untested (`unverified`): it has never been run against a live account, and is written from public documentation and tested offline only. EmailBison (`outbound-sdk/emailbison`, added in 0.5.0) is `unverified` too: no EmailBison account or key is available, so it is written from EmailBison's API reference and tested offline only. Its rate limit is a guess.

The documentation is at [outbound-sdk.dev](https://outbound-sdk.dev). It is built from `site/` in this repository, and every code sample on it is a file the test suite runs.

- [Using the package](packages/outbound-sdk/README.md)
- [Adapters and what each can do](https://outbound-sdk.dev/docs/adapters), with [every endpoint accounted for](https://outbound-sdk.dev/docs/coverage)
- [Insights](https://outbound-sdk.dev/docs/insights): 27 computed answers, from one person across email and LinkedIn to a weekly client report
- [Cards](https://outbound-sdk.dev/docs/cards): every answer as a card for Slack, Chat SDK or any json-render renderer
- [Plugins](https://outbound-sdk.dev/docs/plugins)
- [AI tools](https://outbound-sdk.dev/docs/tools), the [CLI](https://outbound-sdk.dev/docs/cli) and its [MCP server](https://outbound-sdk.dev/docs/cli/mcp), and [webhooks](https://outbound-sdk.dev/docs/webhooks)
- [Guides](https://outbound-sdk.dev/docs/guides): complete tasks, end to end
- [An eve agent](examples/eve-outbound-desk/README.md) built on the SDK: an agency's Slack desk with weekly client reports
- [A MotherDuck data dive](examples/motherduck-data-dive/README.md): every client's campaigns, leads, replies and daily stats loaded into DuckDB or MotherDuck, with a SQL report
- [What is verified](https://outbound-sdk.dev/docs/status)
- For contributors: [architecture](docs/architecture.md), [engineering guardrails](docs/engineering-guardrails.md) and [adding an adapter](docs/new-adapter.md), and [changing and publishing the documentation site](docs/site.md)

## Working on it

```sh
npm ci
npm run check        # lint, types, architecture, repo shape, fixtures, tests, coverage, build, size
npm run check:fast   # the static checks only

npm --prefix site ci && npm run site:dev   # the documentation site, locally
```

See `AGENTS.md` for the rules of the repository.

## License

MIT
