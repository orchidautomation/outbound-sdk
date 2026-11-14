import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import {
  claudeAgentTools,
  claudeToolDefinitions,
} from "outbound-sdk/tools/claude-agent";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

// An in-process MCP server and the names to pre-approve.
const tools = claudeAgentTools(outbound, {
  only: ["campaign_overview", "sender_health"],
});

console.log(tools.serverName, tools.server.type, tools.allowedTools);

// `serverName` changes the prefix the agent addresses the tools by.
console.log(
  claudeAgentTools(outbound, { only: ["reply_samples"], serverName: "sends" })
    .allowedTools
);

// The definitions on their own, to add to an MCP server you build yourself.
const definitions = claudeToolDefinitions(outbound);
const overview = definitions.find((tool) => tool.name === "campaign_overview");

console.log(definitions.length, "definitions;", overview?.annotations);

// What the Agent SDK does when the model calls the tool, done by hand here.
const result = await overview?.handler({ status: "paused" }, undefined);

console.log(JSON.stringify(result, null, 2));

const failed = await overview?.handler({ client: "acme" }, undefined);

console.log(failed?.isError, failed?.content[0]);
