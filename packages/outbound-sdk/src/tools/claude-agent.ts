// outbound-sdk/tools/claude-agent: the tool set for the Claude Agent SDK, as
// an in-process MCP server.
//
//   const tools = claudeAgentTools(outbound);
//   query({ prompt, options: { mcpServers: { outbound: tools.server }, allowedTools: tools.allowedTools } });

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools } from "./registry.ts";
import type { ToolsOptions } from "./registry.ts";

export interface ClaudeAgentToolsOptions extends ToolsOptions {
  /** The MCP server name. Tools are addressed as `mcp__<name>__<tool>`. Defaults to `outbound`. */
  readonly serverName?: string | undefined;
}

export interface ClaudeAgentTools {
  /** Pass as `options.mcpServers[serverName]`. */
  readonly server: McpSdkServerConfigWithInstance;
  /** Every tool is a read, so all of them can be pre-approved. */
  readonly allowedTools: string[];
  readonly serverName: string;
}

/** One Claude Agent SDK tool per outbound tool. Use these to build your own MCP server. */
export const claudeToolDefinitions = (
  outbound: OutboundApi,
  options: ToolsOptions = {}
) =>
  createTools(outbound, options).map((definition) =>
    tool(
      definition.name,
      definition.description,
      definition.fields,
      async (input) => {
        // SAFETY: the SDK validated `input` against the tool's Zod fields, whose values are JSON.
        const result = await definition.call(input as Json);

        return {
          content: [{ text: JSON.stringify(result), type: "text" as const }],
          isError: !result.ok,
        };
      },
      { annotations: { readOnlyHint: true } }
    )
  );

/** The outbound tools as an in-process MCP server for the Claude Agent SDK. */
export const claudeAgentTools = (
  outbound: OutboundApi,
  options: ClaudeAgentToolsOptions = {}
): ClaudeAgentTools => {
  const serverName = options.serverName ?? "outbound";
  const tools = claudeToolDefinitions(outbound, options);

  return {
    allowedTools: tools.map(
      (definition) => `mcp__${serverName}__${definition.name}`
    ),
    server: createSdkMcpServer({ name: serverName, tools, version: "1.0.0" }),
    serverName,
  };
};
