---
"outbound-sdk": patch
---

`outbound mcp` now reports the installed package's version as `serverInfo.version` in its `initialize` answer, instead of `0.0.0`. A server built with `createMcpServer` still reports the `version` option, which defaults to `0.0.0`.
