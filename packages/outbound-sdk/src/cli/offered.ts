// The tools the CLI offers, as `outbound tool`, `outbound tools`,
// `outbound insight` and the MCP server see them: one catalog of the
// built-in tools, then the insights, and every tool left out with the reason.

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools, TOOL_NAMES } from "../tools/index.ts";
import type { OutboundTool, ToolResult } from "../tools/index.ts";
import { leftOutReason } from "../tools/registry.ts";
import { insightToolCaps } from "./config.ts";
import type { InsightToolCaps, PluginFlags } from "./config.ts";
import { Answer } from "./envelope.ts";
import { GROUPS } from "./surface-groups.ts";
import type { Group, Member } from "./surface-groups.ts";
import { aliasTool, sharpen } from "./surface.ts";
import type { Surface } from "./surface.ts";

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
 * The built-in tools and the insights one instance offers, as the catalog
 * lists them, `only` narrowing them by name.
 */
export const offerOn = async (
  instance: OutboundApi,
  caps: InsightToolCaps,
  only?: ReadonlySet<string>
): Promise<{
  readonly members: readonly OutboundApi[];
  readonly tools: OutboundTool[];
}> => {
  const { insightTools, membersOf } = await import("../insights/index.ts");
  const members = await membersOf(instance);
  const names = only === undefined ? undefined : [...only];

  return {
    members,
    tools: createTools(instance, {
      answerNote: false,
      extra: insightTools(instance, {
        ...caps,
        answerNote: false,
        members,
        only: names,
      }),
      members,
      only: TOOL_NAMES.filter((name) => only?.has(name) ?? true),
    }),
  };
};

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
  const { listInsights } = await import("../insights/index.ts");
  const { insightLeftOutReason } = await import("../insights/tools.ts");

  const offer = async (instance: OutboundApi, only?: ReadonlySet<string>) =>
    await offerOn(instance, caps, only);

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

/** The catalog as `outbound mcp` lists it: merged tools, and the old names. */
export const listedTools = async (
  outbound: OutboundApi,
  flags: PluginFlags
): Promise<Catalog & { readonly surface: Surface }> => {
  const caps = insightToolCaps(flags, false);
  const found = await catalog(outbound, caps);

  const surface = sharpen(found.tools, {
    maxRequests: caps.maxRequestsPerToolCall,
    members: () =>
      Promise.resolve(
        found.members.map((member) => ({
          provider: member.provider,
          tools: async () => {
            const served = await offerOn(member, caps);

            return served.tools;
          },
          workspaceId: member.workspaceId,
        }))
      ),
    provider: outbound.provider,
    workspaceId: outbound.workspaceId,
  });

  return { ...found, surface };
};

export interface ListedTool {
  readonly tool: OutboundTool;
  /** The tool whose card draws the answer. */
  readonly card: string;
  /** The answer as that card reads it: one check's own answer, for a merged tool. */
  readonly forCard: (result: ToolResult) => ToolResult;
}

const asItIs = (result: ToolResult): ToolResult => result;

// The view or the one check the input picks, and the tool it runs.
const pickedOf = (group: Group, input: Json): Member | undefined => {
  const given = isJsonObject(input) ? input[group.by] : undefined;
  const picked = Array.isArray(given) ? given : [given ?? group.default[0]];

  return picked.length === 1 &&
    (group.by === "view" || group.default.length === 1 || given !== undefined)
    ? group.members.find((member) => member.key === picked[0])
    : undefined;
};

/** The tool a listed name or an old one runs, and the card that draws its answer. */
export const listedTool = (
  { aliases, tools }: Surface,
  name: string,
  input: Json
): ListedTool | undefined => {
  const listed = tools.find((tool) => tool.name === name);

  if (listed !== undefined) {
    const group = GROUPS.find((each) => each.name === name);
    const member = group === undefined ? undefined : pickedOf(group, input);

    const forCard =
      group?.by !== "checks" || member === undefined
        ? asItIs
        : (result: ToolResult): ToolResult =>
            result.ok && isJsonObject(result.data)
              ? { ...result, data: result.data[member.key] ?? null }
              : result;

    return { card: member?.tool ?? name, forCard, tool: listed };
  }

  const alias = aliases.get(name);

  return alias === undefined
    ? undefined
    : { card: name, forCard: asItIs, tool: aliasTool(name, alias) };
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
