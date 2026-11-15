---
"outbound-sdk": minor
---

`outbound mcp` now masks personal data by default: it runs with `redact()` unless started with `--no-redact`. Every command takes `--config <file>` to load plugins from a file (`defineConfig` from `outbound-sdk/cli`), `--cache <seconds>`, `--max-requests <n>` and `--redact`. The MCP server's `instructions` name the plugins that are on, and a `budget({ per: "run" })` on the instance is reset before each tool call, so its cap is per tool call. `serveStdio(server)` serves a server you build on standard input and output.
