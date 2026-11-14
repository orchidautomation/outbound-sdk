// An MCP server with plugins, for when `outbound mcp` is not enough. Copy it
// into your project and point the client's `command` at it. It picks the
// adapter from OUTBOUND_SDK_PROVIDER and reads that adapter's own key, the
// same way `outbound mcp` does.
import process from "node:process";
import { createInterface } from "node:readline";

import { createOutbound } from "outbound-sdk";
import { createMcpServer } from "outbound-sdk/cli";
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

/** Answers one JSON-RPC message per line until the input ends. */
export const serve = async (
  input: AsyncIterable<string> = createInterface({ input: process.stdin }),
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  }
): Promise<void> => {
  for await (const line of input) {
    const answer = await server.handleLine(line);

    if (answer !== undefined) {
      write(answer);
    }
  }
};

// Serve standard input and output when a client starts this file.
if (import.meta.main) {
  await serve();
}
