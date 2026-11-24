---
"outbound-sdk": patch
---

Point the npm page at the docs and prepare the MCP Registry entry (OUT-187).

- `homepage` is now https://outbound-sdk.dev, and the keywords add `mcp`, `mcp-server`, `instantly-api`, `smartlead-api`, `heyreach-api` and `emailbison-api`.
- `mcpName` is `io.github.orchidautomation/outbound-sdk`, which the official MCP Registry checks before it lists the package. `server.json` beside `package.json` is the registry entry for `outbound mcp`; `npm run version-packages` keeps its version in step.
- No code changes.
