import { createOutbound } from "outbound-sdk";
import { createMcpServer } from "outbound-sdk/cli";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

// What `outbound mcp` builds: the built-in tools, then one tool per insight.
export const server = createMcpServer(outbound, {
  extra: insightTools(outbound),
});
