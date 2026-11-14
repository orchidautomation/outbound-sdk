import { createOutbound } from "outbound-sdk";
import { createMcpServer, PROTOCOL_VERSIONS } from "outbound-sdk/cli";
import { insightTools } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
  // `outbound mcp` turns redact on unless it is started with --no-redact.
  plugins: [redact()],
});

// What `outbound mcp` builds: the tools the instance can serve, then the insights.
const server = createMcpServer(outbound, {
  extra: insightTools(outbound),
  version: "1.0.0",
});

console.log("PROTOCOL_VERSIONS:", PROTOCOL_VERSIONS.join(", "));

// `handle` takes one JSON-RPC message and returns the response.
const initialized = await server.handle({
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "example-client", version: "1.0.0" },
    protocolVersion: "2025-03-26",
  },
});

console.log("\ninitialize");

console.log(JSON.stringify(initialized, null, 2));

// `handleLine` is the same over newline-delimited JSON, as stdio carries it.
const listed = await server.handleLine(
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
);

interface Listed {
  readonly result: { readonly tools: readonly { readonly name: string }[] };
}

// SAFETY: the response to tools/list has this shape; only the names are read.
const { tools } = (JSON.parse(listed ?? "") as Listed).result;

console.log(`\ntools/list: ${tools.length} tools`);

console.log(tools.map((tool) => tool.name).join("\n"));
