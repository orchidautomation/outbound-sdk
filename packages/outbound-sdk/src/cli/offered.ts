// The tools the CLI offers, as `outbound tool`, `outbound tools` and the MCP
// server see them: the built-in ones, then the insights, with cap messages
// that name the CLI's own flag.

import { isJsonObject } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools } from "../tools/index.ts";
import type { OutboundTool } from "../tools/index.ts";
import { insightToolCaps } from "./config.ts";
import type { PluginFlags } from "./config.ts";

/** The tools `outbound mcp` offers: the built-in ones, then the insights. */
export const offeredTools = async (
  outbound: OutboundApi,
  flags: PluginFlags
): Promise<OutboundTool[]> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");

  return createTools(outbound, {
    extra: insightTools(outbound, insightToolCaps(flags, false)),
  });
};

/** A tool as `outbound tools` lists it: its inputs as JSON Schema, as `outbound insight` lists them. */
export const describeTool = (tool: OutboundTool): Json => ({
  description: tool.description,
  name: tool.name,
  parameters: tool.parameters,
});

/** Whether the tool has an input with no default, so it cannot run on none. */
export const requiresInput = (tool: OutboundTool): boolean => {
  const { parameters } = tool;

  return (
    isJsonObject(parameters) &&
    Array.isArray(parameters.required) &&
    parameters.required.length > 0
  );
};
