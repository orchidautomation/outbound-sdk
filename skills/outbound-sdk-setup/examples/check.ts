// Checks the server in server.ts before a client is pointed at it: the lines
// a client would write, fed in place of standard input, on the demo data.
import process from "node:process";

import { run } from "outbound-sdk/cli";

import config from "./outbound.config.ts";

process.env["OUTBOUND_SDK_PROVIDER"] = "memory";

const { serve } = await import("./server.ts");

const lines = async function* lines(): AsyncGenerator<string> {
  yield JSON.stringify({ id: 1, jsonrpc: "2.0", method: "ping" });
  yield JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list" });
  yield JSON.stringify({
    id: 3,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { include_bodies: true }, name: "reply_samples" },
  });
};

await serve(lines(), (line) => {
  const answer = JSON.parse(line);
  const tools = answer.result?.tools;

  console.log(
    Array.isArray(tools)
      ? `${answer.id}: ${tools.length} tools, ${tools.filter((tool: { annotations?: { readOnlyHint?: boolean } }) => tool.annotations?.readOnlyHint === true).length} marked read-only`
      : line
  );
});

// The config file in outbound.config.ts, loaded the way a client would start
// it: `outbound mcp --config outbound.config.ts`.
console.log(
  `\nconfig plugins: ${(config.plugins ?? []).map((plugin) => plugin.name).join(", ")}`
);

await run(["mcp", "--config", "outbound.config.ts"], {
  stderr: (text) => {
    console.log(text);
  },
  stdin: () => [
    JSON.stringify({ id: 4, jsonrpc: "2.0", method: "initialize", params: {} }),
  ],
  stdout: (text) => {
    const { instructions } = JSON.parse(text).result;
    console.log(
      `4: ${instructions.slice(instructions.indexOf("Plugins on:"))}`
    );
  },
});
