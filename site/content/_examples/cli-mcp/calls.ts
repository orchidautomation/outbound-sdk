import { createOutbound } from "outbound-sdk";
import type { Json } from "outbound-sdk";
import { createMcpServer } from "outbound-sdk/cli";
import { demoData, memory } from "outbound-sdk/memory";

const server = createMcpServer(
  createOutbound({ adapter: memory({ data: demoData(), workspaceId: "acme" }) })
);

const send = async (label: string, message: Json) => {
  const response = await server.handle(message);
  console.log(
    `${label}\n${JSON.stringify(response, null, 2) ?? "(no response)"}\n`
  );
};

await send("tools/call", {
  id: 3,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { limit: 1 }, name: "sender_health" },
});

await send(
  "tools/call that fails: a result with isError, not a protocol error",
  {
    id: 4,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { client: "acme" }, name: "campaigns" },
  }
);

await send("tools/call for a tool the server does not have", {
  id: 5,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { name: "send_email" },
});

await send("ping", { id: 6, jsonrpc: "2.0", method: "ping" });

await send("a notification", {
  jsonrpc: "2.0",
  method: "notifications/initialized",
});

await send("a method that is not implemented", {
  id: 7,
  jsonrpc: "2.0",
  method: "resources/list",
});
