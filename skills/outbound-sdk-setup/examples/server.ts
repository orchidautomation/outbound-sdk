// An MCP server of your own, for when you want the instance built in your own
// code rather than loaded by `outbound mcp --config`. Copy it into your
// project and point the client's `command` at it. It picks the
// adapter the same way `outbound mcp` does: the vendor OUTBOUND_SDK_PROVIDER
// names, or, when it is not set, every vendor whose key is set, combined.
import { createOutbound } from "outbound-sdk";
import { createMcpServer, serveStdio } from "outbound-sdk/cli";
import { insightTools } from "outbound-sdk/insights";
import { fromEnv } from "outbound-sdk/loader";
import { redact } from "outbound-sdk/redact";

const outbound = createOutbound({
  adapter: await fromEnv(),
  // Masks personal data in every record before a tool sees it, and refuses
  // reply text. List it first so it is the outermost plugin.
  plugins: [redact()],
});

export const server = createMcpServer(outbound, {
  extra: insightTools(outbound),
});

/**
 * Answers one JSON-RPC message per line until the input ends. With no
 * arguments it serves standard input and output, which is what an MCP client
 * expects of a command it starts.
 */
export const serve = async (
  input?: AsyncIterable<string>,
  write?: (line: string) => void
): Promise<void> => {
  await serveStdio(server, { input, write });
};

// Serve standard input and output when a client starts this file.
if (import.meta.main) {
  await serve();
}
