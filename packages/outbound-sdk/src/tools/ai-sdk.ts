// outbound-sdk/tools/ai-sdk: the tool set for the AI SDK (`ai`).
//
//   generateText({ model, tools: aiSdkTools(outbound), prompt });

import { jsonSchema, tool } from "ai";
import type { Tool } from "ai";

import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools } from "./registry.ts";
import type { ToolsOptions } from "./registry.ts";
import type { ToolResult } from "./shared.ts";

export type AiSdkTools = Record<string, Tool<Json, ToolResult>>;

/** One AI SDK tool per outbound tool, keyed by tool name. */
export const aiSdkTools = (
  outbound: OutboundApi,
  options: ToolsOptions = {}
): AiSdkTools =>
  Object.fromEntries(
    createTools(outbound, options).map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        execute: (input: Json) => definition.call(input),
        // SAFETY: `parameters` is the JSON Schema Zod generated for this tool's input object.
        inputSchema: jsonSchema<Json>(
          definition.parameters as Parameters<typeof jsonSchema>[0]
        ),
      }),
    ])
  );
