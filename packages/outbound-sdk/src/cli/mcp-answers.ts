// What `outbound mcp` says about its answers and what it reads: the
// envelope every tool declares, the summary sent as text beside
// structuredContent, and each tool of a combined instance `scope` reaches.

import { isJsonObject } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools } from "../tools/index.ts";
import type { OutboundTool, ToolResult } from "../tools/index.ts";
import { ALIASES_UNTIL } from "./surface-groups.ts";
import type { ScopeTarget } from "./surface-scope.ts";

// Said once here rather than in every tool's description.
export const ANSWERS =
  "Every answer is { ok, data, meta, next }, in structuredContent with a short summary as text. meta.complete: false means the answer covers part of the data and meta.notes says why; a null count is one the vendor does not report, never 0. Every tool takes scope: { provider, workspace } to read one tool or workspace of what this server reads, and tag where a tool can read one campaign tag. These tools answer questions; for bulk rows (every lead, message or daily stat) use the CLI's --jsonl output or the SDK.";

/** The result schema every tool declares: the answer envelope. */
export const OUTPUT_SCHEMA: JsonObject = {
  properties: {
    data: {},
    meta: { type: "object" },
    next: { type: "string" },
    ok: { type: "boolean" },
  },
  required: ["ok"],
  type: "object",
};

const COMBINED = "combined";

const labelOf = (instance: {
  readonly provider: string;
  readonly workspaceId: string;
}): string => `${instance.provider}:${instance.workspaceId}`;

// Each tool of a combined instance, as `scope` reaches it; none on any other.
export const membersFor = (
  outbound: OutboundApi,
  options: {
    readonly toolsOn?:
      | ((instance: OutboundApi) => Promise<readonly OutboundTool[]>)
      | undefined;
    readonly maxRequestsPerToolCall?: number | undefined;
  }
): (() => Promise<readonly ScopeTarget[]>) => {
  let listed: Promise<readonly ScopeTarget[]> | undefined;

  const list = async (): Promise<readonly ScopeTarget[]> => {
    if (outbound.provider !== COMBINED) {
      return [];
    }

    const { items } = await outbound.workspaces.list();

    return items.map((item) => {
      const instance = outbound.workspace(labelOf(item));
      let built: Promise<readonly OutboundTool[]> | undefined;

      return {
        provider: item.provider,
        tools: () => {
          built ??=
            options.toolsOn?.(instance) ??
            Promise.resolve(
              createTools(instance, {
                answerNote: false,
                maxRequestsPerToolCall: options.maxRequestsPerToolCall,
              })
            );

          return built;
        },
        workspaceId: item.workspaceId,
      };
    });
  };

  return () => {
    listed ??= list();

    return listed;
  };
};

// Names what the server reads, so a model can tell which tool answered.
export const describeBound = (
  members: readonly ScopeTarget[],
  outbound: OutboundApi
): string =>
  members.length === 0
    ? `This server reads ${labelOf(outbound)}.`
    : `This server reads ${members.map(labelOf).join(" and ")} together; scope.provider reads one.`;

/** The old names a call may still use, said once so a CLI insight name is not a dead end. */
export const describeAliases = (names: readonly string[]): string =>
  names.length === 0
    ? ""
    : ` Old names, the CLI's insight names among them, still answer until ${ALIASES_UNTIL}, each with a note naming the tool to call now: ${names.join(", ")}.`;

/** What a tool result says as text: a short summary, the answer itself being structured. */
export const summaryOf = (name: string, outcome: ToolResult): string => {
  if (!outcome.ok) {
    return `${name} failed (${outcome.error.code}): ${outcome.error.message} ${outcome.next}`;
  }

  const { data, meta } = outcome;

  const parts = Array.isArray(data) ? [`${data.length} items`] : [];

  if (isJsonObject(data)) {
    parts.push(
      ...Object.entries(data).map(([key, value]) =>
        Array.isArray(value) ? `${key} (${value.length})` : key
      )
    );
  }

  return `${name}: ${meta.complete ? "complete" : "partial"} answer from ${meta.provider}, ${meta.requests} vendor requests${meta.notes.length > 0 ? `, ${meta.notes.length} notes in meta.notes` : ""}. structuredContent.data holds ${parts.length > 0 ? parts.join(", ") : "the answer"}. Next: ${outcome.next}`;
};
