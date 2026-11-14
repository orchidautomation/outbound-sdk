// Checks the server in server.ts before a client is pointed at it: the lines
// a client would write, fed in place of standard input, on the demo data.
import process from "node:process";

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
