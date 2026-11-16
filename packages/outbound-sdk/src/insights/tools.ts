// The insights as agent tools, in the same form as `outbound-sdk/tools`, so
// they can be handed to any of its wrappers through the `extra` option.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import { jsonInput } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundTool } from "../tools/index.ts";
import { capNext, failure } from "../tools/shared.ts";
import { capStopOf } from "./cost.ts";
import { maskedOutBy } from "./define.ts";
import type { InsightEntry } from "./define.ts";
import { ENTRIES } from "./registry.ts";

export interface InsightToolsOptions {
  /** Offer only these insights, by tool name. Defaults to every one the adapter can serve. */
  readonly only?: readonly string[] | undefined;
  /**
   * The most vendor requests one tool call may send, retries included,
   * across every read the insight makes. Without it a call may send what its
   * input can cost (the insight's default cap), but never more than 500, so a
   * model cannot buy a larger cap by raising a `max_*` input. `Infinity`
   * removes the default.
   */
  readonly maxRequestsPerToolCall?: number | undefined;
}

/** The most an insight tool call may send when no cap is set, whatever its input. */
export const INSIGHT_TOOL_CEILING = 500;

/** What `next` says when every hint an insight wrote names a tool that is not on offer. */
const NEXT_FALLBACK = "Pick another of the listed tools to go further.";

// Said in every insight tool's description, so a model reads coverage where
// every other tool reports it.
const ANSWER_NOTE =
  "The answer is in data, in camelCase like every insight's answer. meta.complete: false means it covers part of the data, and meta.notes says why.";

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
  next: string,
  perCall: number | undefined
): OutboundTool => ({
  call: async (given, callOptions) => {
    const set = callOptions?.maxRequests ?? perCall;

    try {
      const input = jsonInput(given);

      if (input === undefined) {
        throw new OutboundError(
          "Invalid",
          `${definition.name}: the input is not JSON`
        );
      }

      const result = await definition.execute(
        outbound,
        input,
        set === undefined
          ? {
              capCeiling: INSIGHT_TOOL_CEILING,
              capSetting: "maxRequestsPerToolCall",
            }
          : { capSetting: "maxRequestsPerToolCall", maxRequests: set }
      );

      return {
        data: result.data,
        meta: {
          complete: result.meta.complete,
          evidence: result.meta.evidence,
          notes: [...result.meta.notes],
          provider: result.meta.provider,
          requests: result.meta.requests,
        },
        next,
        ok: true,
      };
    } catch (error) {
      const stop = capStopOf(error);

      if (stop !== undefined) {
        return failure(
          error,
          stop.requests,
          capNext(stop.cap, stop.isDefault, stop.lower)
        );
      }

      return failure(
        error,
        undefined,
        OutboundError.is(error) && error.code === "Unsupported"
          ? "This insight cannot answer here; the message says why. Try another tool."
          : undefined
      );
    }
  },
  description: `${definition.description} ${ANSWER_NOTE}`,
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
    toTool(
      outbound,
      definition,
      hintFor(definition.next, names),
      options.maxRequestsPerToolCall
    )
  );
};
