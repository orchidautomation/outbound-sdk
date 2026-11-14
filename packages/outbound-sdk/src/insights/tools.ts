// The insights as agent tools, in the same form as `outbound-sdk/tools`, so
// they can be handed to any of its wrappers through the `extra` option.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundTool } from "../tools/index.ts";
import type { InsightEntry } from "./define.ts";
import { ENTRIES } from "./registry.ts";

export interface InsightToolsOptions {
  /** Offer only these insights, by tool name. Defaults to every one the adapter can serve. */
  readonly only?: readonly string[] | undefined;
}

const toTool = (
  outbound: OutboundApi,
  definition: InsightEntry
): OutboundTool => ({
  call: async (input) => {
    try {
      const result = await definition.execute(outbound, input);

      return {
        data: {
          complete: result.meta.complete,
          notes: [...result.meta.notes],
          result: result.data,
        },
        meta: {
          evidence: result.meta.evidence,
          provider: result.meta.provider,
          requests: result.meta.requests,
        },
        next: definition.next,
        ok: true,
      };
    } catch (error) {
      const known = OutboundError.is(error);

      return {
        error: {
          code: known ? error.code : "Provider",
          message: error instanceof Error ? error.message : String(error),
        },
        next:
          known && error.code === "Unsupported"
            ? "This insight is not available with the current adapter. Try another tool."
            : "Check the input and try again.",
        ok: false,
      };
    }
  },
  description: definition.description,
  fields: definition.inputSchema.shape,
  name: definition.name,
  needs: [...definition.needs],
  // SAFETY: a JSON Schema document is JSON by definition.
  parameters: z.toJSONSchema(definition.inputSchema, { io: "input" }) as Json,
});

/**
 * The insights this instance can serve, as tools. An insight whose adapter
 * lacks a capability it needs is left out, so a model is never offered a tool
 * that cannot work.
 *
 * ```ts
 * openaiTools(outbound, { extra: insightTools(outbound) });
 * ```
 */
export const insightTools = (
  outbound: OutboundApi,
  options: InsightToolsOptions = {}
): OutboundTool[] => {
  const wanted = options.only === undefined ? undefined : new Set(options.only);

  return ENTRIES.flatMap((definition) => {
    const offered =
      (wanted === undefined || wanted.has(definition.name)) &&
      definition.needs.every((key) => outbound.capabilities[key] !== false);

    return offered ? [toTool(outbound, definition)] : [];
  });
};
