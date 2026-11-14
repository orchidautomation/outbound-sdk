import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { openaiTools } from "outbound-sdk/tools";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const { chatTools, handle, tools } = openaiTools(outbound);

// `tools` is the Responses API shape, `chatTools` the Chat Completions shape.
const [first] = tools;

console.log(tools.length, "tools");

console.log({
  description: `${first?.description.slice(0, 40)}...`,
  name: first?.name,
  parameters: "(JSON Schema)",
  strict: first?.strict,
  type: first?.type,
});

console.log(Object.keys(chatTools[0] ?? {}), chatTools[0]?.function.name);

// `handle` takes the call's name and its `arguments` string, and returns the
// string to send back as the call's output.
console.log(await handle("campaign_overview", '{"status":"paused","limit":1}'));

// It never throws. A tool the set does not have and arguments that are not
// JSON are results too.
console.log(await handle("drop_database", "{}"));

console.log(await handle("sender_health", "{not json"));
