import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeAgentTools } from "outbound-sdk/tools/claude-agent";

import { extra, outbound } from "./outbound.ts";

// An in-process MCP server holding the tools, and their names in the form
// the Claude Agent SDK allows by: mcp__outbound__campaign_overview.
const tools = claudeAgentTools(outbound, { extra });

/**
 * Wiring only: this function is not called by the sample, because calling it
 * starts an agent that needs a model and a key.
 */
export const ask = (prompt: string) =>
  query({
    options: {
      // Every tool only reads, so all of them can be allowed up front.
      allowedTools: tools.allowedTools,
      mcpServers: { [tools.serverName]: tools.server },
    },
    prompt,
  });
