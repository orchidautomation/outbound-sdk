import type { JsonObject } from "outbound-sdk";

import { server } from "./server.ts";

// `handle` takes one JSON-RPC message and returns the answer. Over stdio the
// client writes each message as one line and reads each answer as one line.
const show = async (
  label: string,
  message: JsonObject,
  keys?: string[]
): Promise<void> => {
  const answer = await server.handle(message);

  console.log(`--- ${label}`);
  console.log(
    answer === undefined
      ? "(no answer)"
      : JSON.stringify(answer, keys, keys === undefined ? 2 : 0)
  );
};

await show("initialize", {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "example-client", version: "1.0.0" },
    protocolVersion: "2025-06-18",
  },
});

// A notification has no id, so the server writes nothing back.
await show("notifications/initialized", {
  jsonrpc: "2.0",
  method: "notifications/initialized",
});

// Every tool comes with a description and its input as JSON Schema, which
// makes the answer long. Only these keys of it are printed here, on one line.
await show(
  "tools/list (names only)",
  { id: 2, jsonrpc: "2.0", method: "tools/list" },
  ["id", "jsonrpc", "result", "tools", "name"]
);

// The answer is structuredContent; its text is a short summary of it.
await show("tools/call campaigns", {
  id: 3,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { status: "active", view: "list" }, name: "campaigns" },
});
