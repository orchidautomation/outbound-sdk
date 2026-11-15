import { createOutbound } from "outbound-sdk";
import { createMcpServer } from "outbound-sdk/cli";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  // `outbound mcp` turns redact on unless it is started with --no-redact.
  plugins: [redact()],
});

// What `outbound mcp` builds: the built-in tools, then one tool per insight.
export const server = createMcpServer(outbound, {
  extra: insightTools(outbound),
});
