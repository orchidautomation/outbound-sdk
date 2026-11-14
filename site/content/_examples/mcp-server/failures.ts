import type { JsonObject } from "outbound-sdk";

import { server } from "./server.ts";

// `content` repeats `structuredContent` as text, so it is left out here.
const KEYS = [
  "code",
  "error",
  "id",
  "isError",
  "message",
  "ok",
  "result",
  "structuredContent",
];

const call = async (
  label: string,
  name: string,
  input: JsonObject
): Promise<void> => {
  const answer = await server.handle({
    id: label,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: input, name },
  });

  console.log(JSON.stringify(answer, KEYS));
};

// 1. A tool's own failure is a result with isError: true, so the model can
//    read the reason and try again. It is not a protocol error.
await call("bad input", "campaign_trend", {
  campaign: "cmp_founders",
  from: "last week",
  to: "2026-11-13",
});

// 2. An argument the tool does not take is reported, never dropped.
await call("unknown argument", "campaign_overview", { client: "acme" });

// 3. A campaign that does not exist.
await call("no such campaign", "campaign_setup", { campaign: "nope" });

// 4. A tool that is not in the list is a protocol error. There is no tool
//    that writes, so a model cannot call one.
await call("unknown tool", "pause_campaign", { campaign: "cmp_founders" });

// 5. So is a method the server does not implement.
console.log(
  JSON.stringify(
    await server.handle({
      id: "unknown method",
      jsonrpc: "2.0",
      method: "resources/list",
    })
  )
);

// 6. A line that is not JSON gets a parse error with a null id.
console.log(await server.handleLine("{not json"));
