// The insights as agent tools, in the same form as `outbound-sdk/tools`, so
// they can be handed to any of its wrappers through the `extra` option.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import { jsonInput } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundTool } from "../tools/index.ts";
import { maskedOutBy } from "./define.ts";
import type { InsightEntry } from "./define.ts";
import { ENTRIES } from "./registry.ts";

export interface InsightToolsOptions {
  /** Offer only these insights, by tool name. Defaults to every one the adapter can serve. */
  readonly only?: readonly string[] | undefined;
}

/** What `next` says when every hint an insight wrote names a tool that is not on offer. */
const NEXT_FALLBACK = "Pick another of the listed tools to go further.";

/**
 * The insight's hint without the sentences that name an insight not on
 * offer, so a model is never sent to a tool it was not given.
 */
const hintFor = (next: string, offered: ReadonlySet<string>): string => {
  const hidden = ENTRIES.flatMap((entry) =>
    offered.has(entry.name) ? [] : [entry.name]
  );

  const kept = next
    .split(/(?<=\.)\s+/u)
    .filter((sentence) => !hidden.some((name) => sentence.includes(name)));

  return kept.length === 0 ? NEXT_FALLBACK : kept.join(" ");
};

const toTool = (
  outbound: OutboundApi,
  definition: InsightEntry,
  next: string
): OutboundTool => ({
  call: async (given) => {
    try {
      const input = jsonInput(given);

      if (input === undefined) {
        throw new OutboundError(
          "Invalid",
          `${definition.name}: the input is not JSON`
        );
      }

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
        next,
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
            ? "This insight cannot answer here; the message says why. Try another tool."
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
 * lacks a capability or a field it needs, or that cannot match records while the redact
 * plugin masks what it matches on, is left out, so a model is never offered a
 * tool that cannot work. A `next` hint naming a left-out insight is dropped.
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

  const offered = ENTRIES.filter(
    (definition) =>
      (wanted === undefined || wanted.has(definition.name)) &&
      definition.needs.every((key) => outbound.capabilities[key] !== false) &&
      (definition.lacks?.(outbound) ?? null) === null &&
      maskedOutBy(outbound, definition) === null
  );

  const names = new Set(offered.map((definition) => definition.name));

  return offered.map((definition) =>
    toTool(outbound, definition, hintFor(definition.next, names))
  );
};
