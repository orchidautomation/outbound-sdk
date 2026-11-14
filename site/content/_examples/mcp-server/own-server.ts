import process from "node:process";
import { createInterface } from "node:readline";

import { createOutbound } from "outbound-sdk";
import { createMcpServer } from "outbound-sdk/cli";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "./seed.ts";

// Swap memory() for instantly(), smartlead() or heyreach(). redact() is listed
// first so it is the outermost plugin.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [redact()],
});

const server = createMcpServer(outbound, {
  extra: insightTools(outbound),
  version: "1.0.0",
});

/**
 * Answers one JSON-RPC message per line until the input ends. With no
 * arguments it serves standard input and output, which is what an MCP client
 * expects of a command it starts.
 */
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
