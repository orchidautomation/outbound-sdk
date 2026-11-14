import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { aiSdkTools } from "outbound-sdk/tools/ai-sdk";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

// One AI SDK tool per outbound tool, keyed by tool name.
const tools = aiSdkTools(outbound, {
  only: ["campaign_overview", "sender_health"],
});

console.log(Object.keys(tools));

const overview = tools.campaign_overview;

console.log(overview?.description);

// What the AI SDK does when the model calls the tool, done by hand here.
const result = await overview?.execute?.(
  { status: "paused" },
  { context: undefined, messages: [], toolCallId: "call_1" }
);

console.log(JSON.stringify(result, null, 2));

// A failure is a result the model can read, not an exception.
const failed = await overview?.execute?.(
  { client: "acme" },
  { context: undefined, messages: [], toolCallId: "call_2" }
);

console.log(JSON.stringify(failed));
