// outbound-sdk/tools: question-shaped tools for AI agents, as plain
// definitions and in the OpenAI SDK's format, neither of which needs another
// package. The AI SDK and Claude Agent SDK formats import those SDKs, so they
// live in `outbound-sdk/tools/ai-sdk` and `outbound-sdk/tools/claude-agent`.
//
// The customer's model does the reasoning. A tool only reads and arranges.

import { parseJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools } from "./registry.ts";
import type { OutboundTool, ToolsOptions } from "./registry.ts";
import type { ToolResult } from "./shared.ts";

export { createTools, TOOL_NAMES } from "./registry.ts";

export type {
  OutboundTool,
  ToolCallOptions,
  ToolName,
  ToolsOptions,
} from "./registry.ts";

export {
  DEFAULT_BODY_CHARS,
  DEFAULT_TOOL_REQUESTS,
  UNTRUSTED_NOTE,
} from "./shared.ts";

export type {
  MetricSummary,
  ToolFailure,
  ToolResult,
  ToolSuccess,
} from "./shared.ts";

/** One function tool in the OpenAI SDK's shape. */
export interface OpenAiFunctionTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Json;
  readonly strict: false;
}

export interface OpenAiTools {
  /** Pass to `client.responses.create({ tools })`. */
  readonly tools: OpenAiFunctionTool[];
  /** The same tools in the Chat Completions shape. */
  readonly chatTools: {
    readonly type: "function";
    readonly function: Omit<OpenAiFunctionTool, "type">;
  }[];
  /** Runs a function call from the model. `argumentsJson` is the call's `arguments` string. */
  readonly handle: (name: string, argumentsJson: string) => Promise<string>;
}

const toFunction = (tool: OutboundTool): OpenAiFunctionTool => ({
  description: tool.description,
  name: tool.name,
  parameters: tool.parameters,
  strict: false,
  type: "function",
});

/** Tools for the OpenAI SDK. Built without importing `openai`. */
export const openaiTools = (
  outbound: OutboundApi,
  options: ToolsOptions = {}
): OpenAiTools => {
  const tools = createTools(outbound, options);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    chatTools: tools.map((tool) => {
      const { type, ...rest } = toFunction(tool);

      return { function: rest, type };
    }),
    handle: async (name, argumentsJson) => {
      const tool = byName.get(name);
      const input = parseJson(argumentsJson === "" ? "{}" : argumentsJson);

      const result: ToolResult =
        tool === undefined || input === undefined
          ? {
              error: {
                code: "Invalid",
                message:
                  tool === undefined
                    ? `Unknown tool ${name}`
                    : "The arguments are not valid JSON",
                retryable: false,
              },
              next: "Call one of the listed tools with a JSON object.",
              ok: false,
            }
          : await tool.call(input);

      return JSON.stringify(result);
    },
    tools: tools.map(toFunction),
  };
};
