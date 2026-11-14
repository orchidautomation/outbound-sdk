// The insights as methods on the instance, as agent tools and by name.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import type { InsightResult, RunOptions } from "./define.ts";
import { ENTRIES } from "./registry.ts";
import type { AnyInsight } from "./registry.ts";

// What a caller writes: the schema's input type, where a field with a
// default is optional.
type InputOf<Definition> = Definition extends { readonly given?: infer Given }
  ? Given
  : never;

type DataOf<Definition> = Definition extends {
  readonly run: (...args: never[]) => Promise<infer Data>;
}
  ? Data
  : never;

/** One method per insight: `outbound.insights.personSummary({ person })`. */
export type Insights = {
  readonly [Definition in AnyInsight as Definition["key"]]: (
    input: InputOf<Definition>,
    options?: RunOptions
  ) => Promise<InsightResult<DataOf<Definition>>>;
};

export interface InsightsExtension {
  readonly insights: Insights;
}

/** Runs one insight by its tool name or method name, with JSON input. Rejects with `Invalid` for an unknown name. */
export const runInsightByName = async (
  outbound: OutboundApi,
  name: string,
  input: Json = {},
  options: RunOptions = {}
): Promise<InsightResult<Json>> => {
  const entry = ENTRIES.find(
    (candidate) => candidate.name === name || candidate.key === name
  );

  if (entry === undefined) {
    throw new OutboundError(
      "Invalid",
      `There is no insight "${name}". Known: ${ENTRIES.map((each) => each.name).join(", ")}`,
      { provider: outbound.provider }
    );
  }

  return await entry.execute(outbound, input, options);
};

export interface ListedInsight {
  readonly name: string;
  readonly key: string;
  readonly description: string;
  readonly needs: readonly string[];
  /** The input as JSON Schema. */
  readonly parameters: Json;
}

/** What each insight is called, what it answers and what it takes. */
export const listInsights = (): ListedInsight[] =>
  ENTRIES.map((entry) => ({
    description: entry.description,
    key: entry.key,
    name: entry.name,
    needs: [...entry.needs],
    // SAFETY: a JSON Schema document is JSON by definition.
    parameters: z.toJSONSchema(entry.inputSchema, { io: "input" }) as Json,
  }));

// Each method's answer type comes from its own definition, which `Insights`
// spells out; here the methods are built from the untyped list.
type Method = (
  input?: Json,
  options?: RunOptions
) => Promise<InsightResult<never>>;

/**
 * Adds `outbound.insights`: one typed method per insight.
 *
 * ```ts
 * const outbound = createOutbound({ adapter, plugins: [insights()] });
 * await outbound.insights.personSummary({ person: "jane@example.com" });
 * ```
 */
export const insights = (): OutboundPlugin<InsightsExtension> => ({
  extend: (outbound) => {
    const methods: Partial<Record<keyof Insights, Method>> = {};

    for (const entry of ENTRIES) {
      // SAFETY: every entry's key is a key of Insights, which is built from the same list.
      methods[entry.key as keyof Insights] = (input, options) =>
        // SAFETY: the answer is the entry's own, typed per key by Insights.
        entry.execute(outbound, input, options) as Promise<
          InsightResult<never>
        >;
    }

    // SAFETY: one method per registered insight, each parsing its own input.
    return { insights: methods as Insights };
  },
  name: "insights",
});
