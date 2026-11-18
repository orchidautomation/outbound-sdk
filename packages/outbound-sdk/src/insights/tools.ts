// The insights as agent tools, in the same form as `outbound-sdk/tools`, so
// they can be handed to any of its wrappers through the `extra` option.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, isString, jsonInput } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundTool } from "../tools/index.ts";
import { capNext, failure } from "../tools/shared.ts";
import { capStopOf } from "./cost.ts";
import { maskedOutBy } from "./define.ts";
import type { InsightEntry, InsightResult, RunOptions } from "./define.ts";
import { runInsightByName } from "./plugin.ts";
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
  /**
   * What a cap message tells the user to raise. Defaults to
   * `maxRequestsPerToolCall`; a surface that sets the cap its own way names
   * its own, as `outbound mcp` names `--max-requests`.
   */
  readonly capSetting?: string | undefined;
  /**
   * On a combined instance, each of its tools as its own instance, as
   * `outbound.workspace("provider:workspace")` gives them (`membersOf`).
   * With them an insight that only some tools can serve is offered too: one
   * that takes a campaign answers for the campaigns of the tools that serve
   * it and refuses the others' before any request, and one that reads every
   * campaign answers for the one tool that serves it, marked incomplete.
   */
  readonly members?: readonly OutboundApi[] | undefined;
  /**
   * Whether each description ends with how to read the answer (`meta.complete`
   * and `meta.notes`). Defaults to `true`; `outbound mcp` says it once in
   * its instructions instead.
   */
  readonly answerNote?: boolean | undefined;
}

/** The most an insight tool call may send when no cap is set, whatever its input. */
export const INSIGHT_TOOL_CEILING = 500;

/** What `next` says when every hint an insight wrote names a tool that is not on offer. */
const NEXT_FALLBACK = "Pick another of the listed tools to go further.";

// Said in every insight tool's description, so a model reads coverage where
// every other tool reports it.
const ANSWER_NOTE =
  "The answer is in data, in camelCase like every insight's answer. meta.complete: false means it covers part of the data, and meta.notes says why.";

const COMBINED = "combined";

/** Each tool of a combined instance as its own instance; none for any other instance. */
export const membersOf = async (
  outbound: OutboundApi
): Promise<OutboundApi[]> => {
  if (outbound.provider !== COMBINED) {
    return [];
  }

  // A combined instance's workspaces are its tools, listed with no request.
  const { items } = await outbound.workspaces.list();

  return items.map((tool) =>
    outbound.workspace(`${tool.provider}:${tool.workspaceId}`)
  );
};

const labelOf = (outbound: OutboundApi): string =>
  `${outbound.provider}:${outbound.workspaceId}`;

const servesOn = (outbound: OutboundApi, definition: InsightEntry): boolean =>
  definition.needs.every((key) => outbound.capabilities[key] !== false) &&
  (definition.lacks?.(outbound) ?? null) === null &&
  maskedOutBy(outbound, definition) === null;

const takesCampaign = (definition: InsightEntry): boolean =>
  Object.hasOwn(definition.inputSchema.shape, "campaign");

/** Where an insight runs on this instance, and the tools of a combined one that can serve it. */
interface Placement {
  /** The instance the insight runs on: this one, or the one tool that serves it. */
  readonly target: OutboundApi;
  /** On a combined instance the insight cannot serve as a whole, the tools that can. */
  readonly servers: readonly OutboundApi[];
}

/**
 * Where the insight can run, or `undefined` when nowhere on this instance.
 * On a combined instance whose tools do not all serve it, one that takes a
 * campaign runs here and is routed by its campaign; one that reads every
 * campaign runs on the one tool that serves it.
 */
const placementOf = (
  outbound: OutboundApi,
  definition: InsightEntry,
  members: readonly OutboundApi[]
): Placement | undefined => {
  if (servesOn(outbound, definition)) {
    return { servers: [], target: outbound };
  }

  const servers = members.filter((member) => servesOn(member, definition));
  const [only] = servers;

  if (only === undefined) {
    return undefined;
  }

  if (takesCampaign(definition)) {
    return { servers, target: outbound };
  }

  return servers.length === 1 ? { servers, target: only } : undefined;
};

/** The insight entry by its tool name, and where it runs here; `undefined` when it is no insight or cannot run. */
export const insightPlacement = (
  outbound: OutboundApi,
  name: string,
  members: readonly OutboundApi[]
): (Placement & { readonly note: string | null }) | undefined => {
  const definition = ENTRIES.find((entry) => entry.name === name);

  const placed =
    definition === undefined
      ? undefined
      : placementOf(outbound, definition, members);

  if (placed === undefined || placed.target === outbound) {
    return placed === undefined ? undefined : { ...placed, note: null };
  }

  const others = members.flatMap((member) => {
    const why =
      member === placed.target ? undefined : insightLeftOutReason(member, name);

    return why === undefined ? [] : [why];
  });

  return {
    ...placed,
    note: `Covers ${labelOf(placed.target)} only, the one tool on this instance that serves ${name}. ${others.join(". ")}.`,
  };
};

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

/** The answer with every `next` inside it, such as a finding's, cleaned like the tool's own. */
const withOfferedNext = (value: Json, offered: ReadonlySet<string>): Json => {
  if (Array.isArray(value)) {
    return value.map((item) => withOfferedNext(item, offered));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "next" && isString(item)
        ? hintFor(item, offered)
        : withOfferedNext(item, offered),
    ])
  );
};

// The part of a refusal that says what to change, such as `pass bodies: none`.
const REMEDY =
  /(?:[:;.]|,\s*so)\s+(?<remedy>(?:pass|give|use|start|run|name|ask)\s[^;]*?)\.?$/iu;

/** What `next` says when the insight refused this call as unsupported. */
const unsupportedNext = (
  name: string,
  message: string,
  servers: readonly OutboundApi[]
): string => {
  if (servers.length > 0) {
    return `On this instance only ${servers.map(labelOf).join(" and ")} can serve ${name}: call it again with a campaign of ${servers.length === 1 ? "that tool" : "one of them"}, by its ref or name.`;
  }

  const remedy = REMEDY.exec(message)?.groups?.remedy;

  return remedy === undefined
    ? "This insight cannot answer here, and the message says why. Pick another of the listed tools."
    : `Call ${name} again and ${remedy}.`;
};

const toTool = (
  outbound: OutboundApi,
  definition: InsightEntry,
  placement: Placement,
  offered: ReadonlySet<string>,
  options: InsightToolsOptions
): OutboundTool => ({
  call: async (given, callOptions) => {
    const set = callOptions?.maxRequests ?? options.maxRequestsPerToolCall;
    const capSetting = options.capSetting ?? "maxRequestsPerToolCall";

    try {
      const input = jsonInput(given);

      if (input === undefined) {
        throw new OutboundError(
          "Invalid",
          `${definition.name}: the input is not JSON`
        );
      }

      const { target } = placement;

      const note =
        target === outbound
          ? null
          : (insightPlacement(outbound, definition.name, options.members ?? [])
              ?.note ?? null);

      const result = await definition.execute(
        target,
        input,
        set === undefined
          ? { capCeiling: INSIGHT_TOOL_CEILING, capSetting }
          : { capSetting, maxRequests: set }
      );

      return {
        data: withOfferedNext(result.data, offered),
        meta: {
          complete: result.meta.complete && note === null,
          computedAt: result.meta.computedAt,
          evidence: result.meta.evidence,
          notes:
            note === null
              ? [...result.meta.notes]
              : [note, ...result.meta.notes],
          provider: result.meta.provider,
          requests: result.meta.requests,
        },
        next: hintFor(definition.next, offered),
        ok: true,
      };
    } catch (error) {
      const stop = capStopOf(error);

      if (stop !== undefined) {
        return failure(
          error,
          stop.requests,
          capNext(stop.cap, stop.isDefault, stop.lower, capSetting)
        );
      }

      return failure(
        error,
        undefined,
        OutboundError.is(error) && error.code === "Unsupported"
          ? unsupportedNext(definition.name, error.message, placement.servers)
          : undefined
      );
    }
  },
  description:
    options.answerNote === false
      ? definition.description
      : `${definition.description} ${ANSWER_NOTE}`,
  fields: definition.inputSchema.shape,
  name: definition.name,
  needs: [...definition.needs],
  // SAFETY: a JSON Schema document is JSON by definition.
  parameters: z.toJSONSchema(definition.inputSchema, { io: "input" }) as Json,
});

/**
 * Why `insightTools` leaves an insight out on this instance, in the words of
 * an `Unsupported` error. `undefined` for a name that is no insight, or one
 * the instance offers.
 */
export const insightLeftOutReason = (
  outbound: OutboundApi,
  name: string,
  members: readonly OutboundApi[] = []
): string | undefined => {
  const definition = ENTRIES.find((entry) => entry.name === name);

  if (
    definition === undefined ||
    placementOf(outbound, definition, members) !== undefined
  ) {
    return undefined;
  }

  const servers = members.filter((member) => servesOn(member, definition));

  if (servers.length > 1) {
    return `${name} is not available on a combined instance: it reads every campaign, and only ${servers.map(labelOf).join(" and ")} can serve it. Ask one of them`;
  }

  const lacked = definition.lacks?.(outbound) ?? null;

  const absent = definition.needs.filter(
    (key) => outbound.capabilities[key] === false
  );

  if (lacked !== null) {
    return `${name} is not available: the ${outbound.provider} adapter does not report ${lacked}`;
  }

  if (absent.length > 0) {
    return `${name} is not available: the ${outbound.provider} adapter does not support ${absent.join(", ")}`;
  }

  const masked = maskedOutBy(outbound, definition);

  return masked === null
    ? undefined
    : `${name} is not available while the redact plugin masks ${masked}`;
};

/**
 * The insights this instance can serve, as tools. An insight whose adapter
 * lacks a capability or a field it needs, or that cannot match records while the redact
 * plugin masks what it matches on, is left out, so a model is never offered a
 * tool that cannot work; on a combined instance, `members` brings back what
 * one of its tools can serve. A `next` hint naming a left-out insight is
 * dropped, in the tool's `next` and in every `next` its answer holds.
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
  const members = options.members ?? [];

  const offered = ENTRIES.flatMap((definition) => {
    const placement =
      wanted === undefined || wanted.has(definition.name)
        ? placementOf(outbound, definition, members)
        : undefined;

    return placement === undefined ? [] : [{ definition, placement }];
  });

  const names = new Set(offered.map(({ definition }) => definition.name));

  return offered.map(({ definition, placement }) =>
    toTool(outbound, definition, placement, names, options)
  );
};

/**
 * Runs the insight where it runs here: on a combined instance, one that only
 * one of its tools serves runs on that tool, its answer marked incomplete
 * with a note naming the others.
 */
export const runPlaced = async (
  outbound: OutboundApi,
  name: string,
  input: Json | undefined,
  members: readonly OutboundApi[],
  options?: RunOptions
): Promise<InsightResult<Json>> => {
  const placed = insightPlacement(outbound, name, members);

  const result = await runInsightByName(
    placed?.target ?? outbound,
    name,
    input,
    options
  );

  return placed?.note === null || placed?.note === undefined
    ? result
    : {
        ...result,
        meta: {
          ...result.meta,
          complete: false,
          notes: [placed.note, ...result.meta.notes],
        },
      };
};
