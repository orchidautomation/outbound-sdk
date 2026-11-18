// The tools the CLI offers, as `outbound tool`, `outbound tools`,
// `outbound insight` and the MCP server see them: one catalog of the
// built-in tools, then the insights, and every tool left out with the reason.

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools, TOOL_NAMES } from "../tools/index.ts";
import type { OutboundTool } from "../tools/index.ts";
import { leftOutReason } from "../tools/registry.ts";
import { insightToolCaps } from "./config.ts";
import type { InsightToolCaps, PluginFlags } from "./config.ts";
import { Answer } from "./envelope.ts";

// How a tool redact left out is turned on. Only `outbound mcp` passes the
// unmasked instance that tells them apart, and it turns redact on itself.
const NO_REDACT =
  "Start the server with --no-redact to offer it; personal fields are then not masked.";

export interface Catalog {
  /** The tools this instance offers: the built-in ones, then the insights. */
  readonly tools: readonly OutboundTool[];
  /** Every other tool, by name, with the reason it is left out. */
  readonly leftOut: Readonly<Record<string, string>>;
  /**
   * Of `leftOut`, the tools another setting would offer, with how: those
   * redact left out, and those one tool of a combined instance serves alone.
   * The MCP server names them; what the vendor cannot do it does not.
   */
  readonly turnOn: Readonly<Record<string, string>>;
  /** Each tool of a combined instance as its own instance; none on any other. */
  readonly members: readonly OutboundApi[];
  /** What the instance offers by name, whatever `wanted` names. */
  readonly offered: readonly string[];
}

/**
 * The one catalog every CLI surface reads. `unmasked` is the same instance
 * without redact, to tell which tools redact left out; `wanted` is what
 * `--tools` names, which narrows what is offered but not what is left out.
 */
export const catalog = async (
  outbound: OutboundApi,
  caps: InsightToolCaps,
  unmasked?: OutboundApi | undefined,
  wanted?: ReadonlySet<string> | undefined
): Promise<Catalog> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools, listInsights, membersOf } =
    await import("../insights/index.ts");

  const { insightLeftOutReason } = await import("../insights/tools.ts");

  const offer = async (instance: OutboundApi, only?: ReadonlySet<string>) => {
    const members = await membersOf(instance);
    const names = only === undefined ? undefined : [...only];

    return {
      members,
      tools: createTools(instance, {
        extra: insightTools(instance, { ...caps, members, only: names }),
        members,
        only: TOOL_NAMES.filter((name) => only?.has(name) ?? true),
      }),
    };
  };

  const here = await offer(outbound, wanted);
  const every = wanted === undefined ? here : await offer(outbound);
  const offered = new Set(every.tools.map((tool) => tool.name));

  const open = unmasked === undefined ? undefined : await offer(unmasked);
  const unmaskedNames = new Set(open?.tools.map((tool) => tool.name));

  // A tool one tool of a combined instance serves alone, such as its native reads.
  const servedAlone = (name: string): OutboundApi | undefined =>
    here.members.find(
      (member) =>
        leftOutReason(member, name) === undefined &&
        insightLeftOutReason(member, name) === undefined
    );

  // The reason, and whether another setting offers the tool.
  const reasonFor = (name: string): [string, boolean] => {
    if (unmaskedNames.has(name)) {
      return [
        `${name} is left out while the redact plugin is on: it needs what redact masks. ${NO_REDACT}`,
        true,
      ];
    }

    const why =
      leftOutReason(outbound, name, here.members) ??
      insightLeftOutReason(outbound, name, here.members) ??
      `${name} is not available on this instance`;

    const alone = servedAlone(name);

    return alone === undefined
      ? [why, false]
      : [
          `${why}. Run it with --provider ${alone.provider} to read ${alone.provider} on its own.`,
          true,
        ];
  };

  const leftOut: Record<string, string> = {};
  const turnOn: Record<string, string> = {};

  for (const name of [
    ...TOOL_NAMES,
    ...listInsights().map((insight) => insight.name),
  ]) {
    if (!offered.has(name)) {
      const [why, elsewhere] = reasonFor(name);

      leftOut[name] = why;

      if (elsewhere) {
        turnOn[name] = why;
      }
    }
  }

  return {
    leftOut,
    members: here.members,
    offered: [...offered],
    tools: here.tools,
    turnOn,
  };
};

/** The tools `outbound mcp` offers: the built-in ones, then the insights. */
export const offeredTools = async (
  outbound: OutboundApi,
  flags: PluginFlags
): Promise<Catalog> => await catalog(outbound, insightToolCaps(flags, false));

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

/** A catalog list, with each left-out tool's reason as a note. */
export const listedWith = (
  items: Json,
  leftOut: Readonly<Record<string, string>>
): Answer =>
  new Answer(items, { complete: true, notes: Object.values(leftOut) }, true);

/** `outbound insight` with no name: the catalog's insights, and why each other one is left out. */
export const listedInsights = async ({
  leftOut,
  offered,
}: Catalog): Promise<Answer> => {
  const { listInsights } = await import("../insights/index.ts");
  const insights = listInsights();

  const isInsight = (name: string) =>
    insights.some((insight) => insight.name === name);

  return listedWith(
    toJson(insights.filter((insight) => offered.includes(insight.name))),
    Object.fromEntries(
      Object.entries(leftOut).filter(([name]) => isInsight(name))
    )
  );
};

/** Throws `Unsupported` with the reason when the catalog leaves the tool out. */
export const refuseLeftOut = (
  outbound: OutboundApi,
  { leftOut }: Catalog,
  name: string
): void => {
  const why = leftOut[name];

  if (why !== undefined) {
    throw new OutboundError("Unsupported", why, {
      provider: outbound.provider,
    });
  }
};
