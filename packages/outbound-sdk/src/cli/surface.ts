// The tool set `outbound mcp` lists, made from the built-in tools and the
// insights: neighbours merged into one tool picked by `view` or `checks`,
// a `scope` input on every tool, and every old name kept as an alias that
// says what replaced it (OUT-168).

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, isString, jsonInput } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundTool, ToolResult } from "../tools/index.ts";
import type { ToolCallOptions } from "../tools/registry.ts";
import { DEFAULT_TOOL_REQUESTS, failure } from "../tools/shared.ts";
import { unansweredReplies } from "./replies-thread.ts";
import { combined, requestsOf, sharedCapStop } from "./surface-checks.ts";
import { ALIASES_UNTIL, GROUPS, RENAMED } from "./surface-groups.ts";
import type { Group } from "./surface-groups.ts";
import {
  mergedProperties,
  propertiesOf,
  requiredOf,
  selectorSchema,
} from "./surface-schema.ts";
import { scopeField, scoped, takes } from "./surface-scope.ts";
import type { Scoping } from "./surface-scope.ts";

export type { Scoping } from "./surface-scope.ts";

export interface Alias {
  /** The tool the old name runs, as it ran before. */
  readonly tool: OutboundTool;
  /** What the old name became, as a model calls it. */
  readonly becomes: string;
}

export interface Surface {
  readonly tools: readonly OutboundTool[];
  /** Every old name still answered, by name. */
  readonly aliases: ReadonlyMap<string, Alias>;
  /** Tools left out here whose view a listed tool still answers, masked. */
  readonly covered: ReadonlySet<string>;
}

/** How an old name is called now, such as `campaigns with view "ranking"`. */
const callsFor = (): Map<string, string> => {
  const calls = new Map<string, string>(Object.entries(RENAMED));

  for (const group of GROUPS) {
    for (const member of group.members) {
      if (member.tool !== group.name) {
        calls.set(
          member.tool,
          group.by === "view"
            ? `${group.name} with view "${member.key}"`
            : `${group.name} with checks ["${member.key}"]`
        );
      }
    }
  }

  return calls;
};

const CALLS = callsFor();

/** Every old tool name `outbound mcp` still answers, with how it is called now. */
export const RENAMED_TOOLS: Readonly<Record<string, string>> =
  Object.fromEntries(CALLS);

const OLD_NAME = new RegExp(`\\b(?:${[...CALLS.keys()].join("|")})\\b`, "gu");

/** The text with every old tool name replaced by how it is called now. */
export const withNewNames = (text: string): string =>
  text.replaceAll(OLD_NAME, (name) => CALLS.get(name) ?? name);

// Every `next` in an answer, findings' included, names tools as listed.
const renamedNext = (value: Json): Json => {
  if (Array.isArray(value)) {
    return value.map(renamedNext);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "next" && isString(item) ? withNewNames(item) : renamedNext(item),
    ])
  );
};

// Every hint names tools as listed. A listed tool's own refusal does too; an
// old name's keeps its words, as it answered before.
const listedNames = (result: ToolResult, asListed = true): ToolResult => {
  if (result.ok) {
    return {
      ...result,
      data: renamedNext(result.data),
      next: withNewNames(result.next),
    };
  }

  const message = asListed
    ? withNewNames(result.error.message)
    : result.error.message;

  return {
    ...result,
    error: { ...result.error, message },
    next: withNewNames(result.next),
  };
};

/** The notes of an answer, with more in front. */
export const noted = (
  result: ToolResult,
  notes: readonly string[]
): ToolResult => {
  if (notes.length === 0) {
    return result;
  }

  return result.ok
    ? {
        ...result,
        meta: { ...result.meta, notes: [...notes, ...result.meta.notes] },
      }
    : { ...result, next: `${result.next} ${notes.join(" ")}` };
};

const invalid = (message: string): ToolResult =>
  failure(new OutboundError("Invalid", message));

/** The checks or the view the input names, or why not. */
const chosenOf = (
  group: Group,
  keys: readonly string[],
  defaults: readonly string[],
  given: Json | undefined
): readonly string[] | string => {
  const asList = Array.isArray(given) ? given : [given];
  const named = given === undefined || given === null ? defaults : asList;

  const wrong = named.find((key) => !isString(key) || !keys.includes(key));

  if (
    wrong !== undefined ||
    named.length === 0 ||
    (group.by === "view" && named.length > 1)
  ) {
    return `${group.name}: ${group.by} must be ${group.by === "view" ? "one of" : "a list of"} ${keys.map((key) => JSON.stringify(key)).join(", ")}`;
  }

  return named.filter(isString);
};

/** A refusal, said as a message, where a value was expected. */
const isMessage = <Value>(value: Value | string): value is string =>
  typeof value === "string";

interface MemberArgs {
  readonly args: JsonObject;
  readonly notes: readonly string[];
}

// Only the fields the member takes go to it; the others are named in a note.
const argsFor = (
  tool: OutboundTool,
  rest: JsonObject,
  key: string
): MemberArgs => {
  const own = propertiesOf(tool);
  const args: Record<string, Json> = {};
  const ignored: string[] = [];

  for (const [name, value] of Object.entries(rest)) {
    if (Object.hasOwn(own, name)) {
      args[name] = value;
    } else {
      ignored.push(name);
    }
  }

  return {
    args,
    notes:
      ignored.length === 0
        ? []
        : [
            `${ignored.join(", ")} not used: ${key} does not take ${ignored.length === 1 ? "it" : "them"}.`,
          ],
  };
};

interface Built {
  readonly group: Group;
  readonly present: ReadonlyMap<string, OutboundTool>;
  /** The member a view the instance lacks falls back to, for `person` under redact. */
  readonly fallback: string | undefined;
}

const runMember = async (
  scoping: Scoping,
  name: string,
  tool: OutboundTool,
  rest: JsonObject,
  scope: Json | undefined,
  options: ToolCallOptions | undefined
): Promise<ToolResult> => {
  // A tool listed as it is checks its own input, strays included.
  const own: MemberArgs = { args: rest, notes: [] };
  const { args, notes } = name === tool.name ? own : argsFor(tool, rest, name);

  const target = await scoped(scoping, tool, args, scope);

  return isMessage(target)
    ? invalid(target)
    : noted(await target.tool.call(target.args, options), [
        ...notes,
        ...target.notes,
      ]);
};

interface CheckCall {
  readonly rest: JsonObject;
  readonly scope: Json | undefined;
  readonly options: ToolCallOptions | undefined;
}

// One check after another, so the checks share the call's request cap.
const runChecks = async (
  scoping: Scoping,
  { fallback, present }: Built,
  chosen: readonly string[],
  { options, rest, scope }: CheckCall
): Promise<(readonly [string, ToolResult])[]> => {
  const results: (readonly [string, ToolResult])[] = [];

  // Checks run together share one cap; a check run alone keeps its own default.
  const cap =
    options?.maxRequests ??
    scoping.maxRequests ??
    (chosen.length > 1 ? DEFAULT_TOOL_REQUESTS : undefined);

  let spent = 0;

  for (const key of chosen) {
    const own = present.get(key);

    const tool =
      own ?? (fallback === undefined ? undefined : present.get(fallback));

    const left =
      cap === undefined || cap === Infinity ? undefined : cap - spent;

    if (left !== undefined && left <= 0) {
      results.push([
        key,
        failure(
          new OutboundError(
            "RateLimited",
            `${key} was not run: the checks before it spent the call's cap of ${cap} requests.`,
            { limit: "call", provider: scoping.provider }
          )
        ),
      ]);
      continue;
    }

    const shared = left !== undefined && chosen.length > 1;

    // SAFETY: keys only holds members present here or reached by the fallback.
    // oxlint-disable-next-line no-await-in-loop -- each check spends from what the ones before it left.
    const result = await runMember(
      scoping,
      key,
      tool as OutboundTool,
      rest,
      scope,
      left === undefined ? options : { ...options, maxRequests: left }
    );

    spent += requestsOf(result);

    const capped =
      shared && cap !== undefined
        ? sharedCapStop(
            result,
            key,
            cap,
            options?.maxRequests ?? scoping.maxRequests
          )
        : result;

    results.push([
      key,
      own === undefined
        ? noted(capped, [
            `view ${key} needs identifiers the redact plugin masks, so this is the masked ${fallback} view. Start the server with --no-redact for it.`,
          ])
        : capped,
    ]);
  }

  return results;
};

const mergedTool = (scoping: Scoping, built: Built): OutboundTool => {
  const { fallback, group, present } = built;

  const keys = group.members.flatMap((member) =>
    present.has(member.key) || fallback !== undefined ? [member.key] : []
  );

  // The group's default where this server has it, else its first member here.
  const listedDefault = group.default.filter((key) => keys.includes(key));

  const defaults =
    listedDefault.length > 0 || keys[0] === undefined
      ? listedDefault
      : [keys[0]];

  const properties = mergedProperties(group, present);
  const tools = [...present.values()];
  const owned = new Set(Object.keys(properties));

  // Required only when every member requires it.
  let required = tools[0] === undefined ? [] : [...requiredOf(tools[0])];

  for (const tool of tools) {
    const own = requiredOf(tool);

    required = required.filter((name) => own.includes(name));
  }

  return {
    call: async (given, options) => {
      const input = jsonInput(given ?? {});

      if (!isJsonObject(input)) {
        return invalid(`${group.name}: the input must be a JSON object`);
      }

      const { [group.by]: selected, scope, ...rest } = input;
      const chosen = chosenOf(group, keys, defaults, selected);

      if (isMessage(chosen)) {
        return invalid(chosen);
      }

      const stray = Object.keys(rest).find((name) => !owned.has(name));

      if (stray !== undefined) {
        return invalid(
          `${group.name}: "${stray}" is not an input. It takes: ${[group.by, ...owned, "scope"].toSorted().join(", ")}`
        );
      }

      const results = await runChecks(scoping, built, chosen, {
        options,
        rest,
        scope,
      });

      const [only] = results;

      return listedNames(
        group.by === "view" && only !== undefined ? only[1] : combined(results)
      );
    },
    description: group.description,
    // Each member parses its own input, so these are for listing only.
    fields: {
      [group.by]: z.string().optional(),
      scope: z.json().optional(),
    },
    name: group.name,
    needs: [...new Set(tools.flatMap((tool) => tool.needs))],
    parameters: {
      additionalProperties: false,
      properties: {
        [group.by]: selectorSchema(group, keys, defaults),
        ...properties,
        scope: scopeField(tools.some((tool) => takes(tool, "tag"))),
      },
      required,
      type: "object",
    },
  };
};

/** A tool listed as it is, with `scope` added and old names in its hints replaced. */
const scopedTool = (scoping: Scoping, tool: OutboundTool): OutboundTool => ({
  ...tool,
  call: async (given, options) => {
    const input = jsonInput(given ?? {});

    if (!isJsonObject(input)) {
      return tool.call(given, options);
    }

    const { scope, ...rest } = input;

    return listedNames(
      await runMember(scoping, tool.name, tool, rest, scope, options)
    );
  },
  description: withNewNames(tool.description),
  parameters: isJsonObject(tool.parameters)
    ? {
        ...tool.parameters,
        properties: {
          ...propertiesOf(tool),
          scope: scopeField(takes(tool, "tag")),
        },
      }
    : tool.parameters,
});

const aliasNote = (name: string, becomes: string): string =>
  `${name} is an old name kept until ${ALIASES_UNTIL}: call ${becomes} instead.`;

/** An old name: the tool it ran, as it ran, with a note naming what replaced it. */
export const aliasTool = (name: string, alias: Alias): OutboundTool => ({
  ...alias.tool,
  call: async (given, options) =>
    noted(listedNames(await alias.tool.call(given, options), false), [
      aliasNote(name, alias.becomes),
    ]),
  name,
});

/**
 * The listed tools for a set of built-in tools and insights. A tool in no
 * group is listed as it is; a group is listed when any of its members is.
 */
export const sharpen = (
  raw: readonly OutboundTool[],
  scoping: Scoping
): Surface => {
  const byName = new Map(raw.map((tool) => [tool.name, tool]));
  const absorbed = new Set<string>();
  const covered = new Set<string>();
  const merged = new Map<string, OutboundTool>();

  for (const group of GROUPS) {
    const present = new Map(
      group.members.flatMap((member) => {
        const tool = byName.get(member.tool);

        return tool === undefined ? [] : [[member.key, tool] as const];
      })
    );

    if (present.size === 0) {
      continue;
    }

    for (const member of group.members) {
      absorbed.add(member.tool);
    }

    const fallback =
      group.name === "person" && present.has("summary") ? "summary" : undefined;

    for (const member of group.members) {
      if (fallback !== undefined && !present.has(member.key)) {
        covered.add(member.tool);
      }
    }

    merged.set(group.name, mergedTool(scoping, { fallback, group, present }));
  }

  const tools = raw.flatMap((tool) => {
    if (Object.hasOwn(RENAMED, tool.name)) {
      return [
        unansweredReplies(
          scopedTool(scoping, tool),
          byName.get("thread_context")
        ),
      ];
    }

    const group = GROUPS.find((each) =>
      each.members.some((member) => member.tool === tool.name)
    );

    if (group !== undefined) {
      const first = group.members.find((member) => byName.has(member.tool));
      const tool_ = merged.get(group.name);

      return first?.tool === tool.name && tool_ !== undefined ? [tool_] : [];
    }

    return absorbed.has(tool.name) ? [] : [scopedTool(scoping, tool)];
  });

  const aliases = new Map<string, Alias>(
    [...CALLS].flatMap(([name, becomes]) => {
      const tool = byName.get(name);

      return tool === undefined ? [] : [[name, { becomes, tool }] as const];
    })
  );

  // A covered old name answers through the view that covers it, masked.
  for (const group of GROUPS) {
    const tool = merged.get(group.name);

    for (const member of group.members) {
      if (tool !== undefined && covered.has(member.tool)) {
        aliases.set(member.tool, {
          becomes: CALLS.get(member.tool) ?? group.name,
          tool: {
            ...tool,
            call: (given, options) => {
              const input = jsonInput(given ?? {});

              return isJsonObject(input)
                ? tool.call({ ...input, [group.by]: member.key }, options)
                : tool.call(given, options);
            },
          },
        });
      }
    }
  }

  return { aliases, covered, tools };
};
