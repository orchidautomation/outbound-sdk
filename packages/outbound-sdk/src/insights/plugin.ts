// The insights as methods on the instance, as agent tools and by name.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { boundsOf, defaultCap } from "./cost.ts";
import type { InsightEntry, InsightResult, RunOptions } from "./define.ts";
import type { InsightInputs } from "./inputs.generated.ts";
import { ENTRIES } from "./registry.ts";
import type { AnyInsight } from "./registry.ts";

type DataOf<Definition> = Definition extends {
  readonly run: (...args: never[]) => Promise<infer Data>;
}
  ? Data
  : never;

/**
 * One method per insight: `outbound.insights.personSummary({ person })`. The
 * input is the generated `InsightInputs` entry, which is the schema's input
 * type with each field's default and range in its JSDoc.
 */
export type Insights = {
  readonly [Definition in AnyInsight as Definition["key"]]: (
    input: InsightInputs[Definition["key"]],
    options?: RunOptions
  ) => Promise<InsightResult<DataOf<Definition>>>;
};

export interface InsightsExtension {
  readonly insights: Insights;
}

const entryNamed = (outbound: OutboundApi, name: string): InsightEntry => {
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

  return entry;
};

/** Runs one insight by its tool name or method name, with JSON input. Rejects with `Invalid` for an unknown name. */
export const runInsightByName = async (
  outbound: OutboundApi,
  name: string,
  input: Json = {},
  options: RunOptions = {}
): Promise<InsightResult<Json>> =>
  await entryNamed(outbound, name).execute(outbound, input, options);

/** What one run of an insight can cost, in vendor requests. */
export interface InsightCostEstimate {
  /** The least it can send: what is refused before any request when over the cap. */
  readonly min: number;
  /** The most it can send without retries, every cap in its input reached. */
  readonly max: number;
  /** The cap it runs under when none is set. */
  readonly defaultCap: number;
}

/**
 * What an insight costs for this input on this instance, or `null` when the
 * adapter declares no costs (a combined instance) or the insight states none.
 * Throws `Invalid` for an unknown insight or an input its schema refuses.
 *
 * ```ts
 * insightCost(outbound, "client_report"); // { min: 3, max: 226, defaultCap: 287 }
 * ```
 */
export const insightCost = (
  outbound: OutboundApi,
  name: string,
  input: Json = {}
): InsightCostEstimate | null => {
  const entry = entryNamed(outbound, name);
  const parsed = entry.inputSchema.safeParse(input);

  if (!parsed.success) {
    throw new OutboundError(
      "Invalid",
      `${entry.name}: ${parsed.error.issues[0]?.message ?? "the input is not valid"}`,
      { provider: outbound.provider }
    );
  }

  // SAFETY: the entry's own schema parsed the input, which is what its cost takes.
  const bounds = boundsOf(outbound, entry.cost, parsed.data as never);

  return bounds === null ? null : { ...bounds, defaultCap: defaultCap(bounds) };
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
