<img src="assets/icon.svg" width="64" height="64" alt="">

# outbound-sdk

One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead and HeyReach. What the three share is normalized; everything else each one can report is still there through a typed native catalog, so nothing readable is dropped. It never writes to a vendor tool, stores nothing and calls no AI model.

```ts
import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const outbound = createOutbound({ adapter: instantly() });
for await (const campaign of outbound.campaigns.listAll({ status: "active" })) {
  console.log(campaign.name, campaign.ref);
}
```

> Status: 0.1.0 is on npm (`npm install outbound-sdk`). HeyReach and Instantly are `beta` (their reads were run against a live workspace each). Smartlead ships untested (`unverified`): it has never been run against a live account, and is written from public documentation and tested offline only.

The documentation is at [outbound-sdk.dev](https://outbound-sdk.dev). It is built from `site/` in this repository, and every code sample on it is a file the test suite runs.

- [Using the package](packages/outbound-sdk/README.md)
- [Adapters and what each can do](https://outbound-sdk.dev/docs/adapters), with [every endpoint accounted for](https://outbound-sdk.dev/docs/coverage)
- [Insights](https://outbound-sdk.dev/docs/insights): 26 computed answers, from one person across email and LinkedIn to a weekly client report
- [Cards](https://outbound-sdk.dev/docs/cards): every answer as a card for Slack, Chat SDK or any json-render renderer
- [Plugins](https://outbound-sdk.dev/docs/plugins)
- [AI tools](https://outbound-sdk.dev/docs/tools), the [CLI](https://outbound-sdk.dev/docs/cli) and its [MCP server](https://outbound-sdk.dev/docs/cli/mcp), and [webhooks](https://outbound-sdk.dev/docs/webhooks)
- [Guides](https://outbound-sdk.dev/docs/guides): complete tasks, end to end
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
