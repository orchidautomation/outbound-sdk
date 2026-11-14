import { query } from "@anthropic-ai/claude-agent-sdk";
import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { claudeAgentTools } from "outbound-sdk/tools/claude-agent";

// Reads INSTANTLY_API_KEY. Constructing it makes no request.
const outbound = createOutbound({ adapter: instantly() });
const tools = claudeAgentTools(outbound);

/** Wiring only: the test suite defines this function and never calls it. */
export const ask = async (prompt: string) => {
  const answers: string[] = [];

  for await (const message of query({
    options: {
      allowedTools: tools.allowedTools,
      mcpServers: { [tools.serverName]: tools.server },
    },
    prompt,
  })) {
    if (message.type === "result" && message.subtype === "success") {
      answers.push(message.result);
    }
  }

  return answers.join("\n");
};
