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

> Status: not published to npm yet. HeyReach and Instantly are `beta` (their reads were run against a live workspace each). Smartlead is `unverified`: written from public documentation and tested offline.

- [Using the package](packages/outbound-sdk/README.md)
- [Adapters and what each can do](docs/adapters.md), with [every endpoint accounted for](docs/coverage/README.md)
- [Plugins](docs/plugins.md)
- [AI tools, the MCP server, the CLI and webhooks](docs/tools-and-webhooks.md)
- [Architecture](docs/architecture.md) and [engineering guardrails](docs/engineering-guardrails.md)
- [Adding an adapter](docs/new-adapter.md)

## Working on it

```sh
npm ci
npm run check        # lint, types, architecture, repo shape, fixtures, tests, coverage, build, size
npm run check:fast   # the static checks only
```

See `AGENTS.md` for the rules of the repository.

## License

MIT
