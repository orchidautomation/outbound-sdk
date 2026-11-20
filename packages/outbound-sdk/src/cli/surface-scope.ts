// The `scope` input every listed tool takes: one provider, one workspace or
// one campaign tag of what the server reads.

import { isJsonObject, isString } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundTool } from "../tools/index.ts";

/** One tool of a combined instance, and its own tools. */
export interface ScopeTarget {
  readonly provider: string;
  readonly workspaceId: string;
  readonly tools: () => Promise<readonly OutboundTool[]>;
}

/** What the server reads: the bound instance, and on a combined one each of its tools. */
export interface Scoping {
  readonly provider: string;
  readonly workspaceId: string;
  /** Each tool of a combined instance; none on any other. */
  readonly members: () => Promise<readonly ScopeTarget[]>;
  /** The server's request cap per tool call, which a merged tool's checks share. */
  readonly maxRequests?: number | undefined;
}

/** Whether the tool has the input. */
export const takes = (tool: OutboundTool, name: string): boolean => {
  const properties = isJsonObject(tool.parameters)
    ? tool.parameters["properties"]
    : undefined;

  return isJsonObject(properties) && Object.hasOwn(properties, name);
};

// Kept small, since every tool lists it: initialize says what it does.
export const scopeField = (tagged: boolean): Json => {
  const names = tagged
    ? ["provider", "tag", "workspace"]
    : ["provider", "workspace"];

  return {
    properties: Object.fromEntries(
      names.map((name) => [name, { type: "string" }])
    ),
    type: "object",
  };
};

const labelOf = (target: {
  readonly provider: string;
  readonly workspaceId: string;
}) => `${target.provider}:${target.workspaceId}`;

export interface Scoped {
  readonly tool: OutboundTool;
  readonly args: JsonObject;
  readonly notes: readonly string[];
}

const textOf = (
  value: Json | undefined,
  name: string
): string | undefined | Error => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return isString(value) && value.trim() !== ""
    ? value.trim()
    : new Error(`scope.${name} must be a non-empty string`);
};

interface Named {
  readonly provider: string | undefined;
  readonly workspace: string | undefined;
  readonly tag: string | undefined;
}

// What `scope` names, or why it cannot be read.
const namedBy = (name: string, scope: JsonObject): Named | string => {
  const stray = Object.keys(scope).find(
    (key) => !["provider", "tag", "workspace"].includes(key)
  );

  if (stray !== undefined) {
    return `${name}: scope takes provider, workspace and tag, not ${stray}`;
  }

  const provider = textOf(scope["provider"], "provider");
  const workspace = textOf(scope["workspace"], "workspace");
  const tag = textOf(scope["tag"], "tag");

  for (const problem of [provider, workspace, tag]) {
    if (problem instanceof Error) {
      return `${name}: ${problem.message}`;
    }
  }

  // SAFETY: each was checked above to be a string or undefined.
  return { provider, tag, workspace } as Named;
};

const isRefusal = (value: Named | string): value is string =>
  typeof value === "string";

const labelsOf = (named: Named): string =>
  [named.provider, named.workspace].filter(isString).join(":");

// The one tool of a combined instance the scope names, and the tool there.
const onMember = async (
  scoping: Scoping,
  tool: OutboundTool,
  given: JsonObject,
  named: Named
): Promise<Scoped | string> => {
  const members = await scoping.members();

  const matches = members.filter(
    (member) =>
      (named.provider === undefined || member.provider === named.provider) &&
      (named.workspace === undefined || member.workspaceId === named.workspace)
  );

  const [only] = matches;

  if (only === undefined) {
    return `Nothing this server reads matches scope ${labelsOf(named)}. It reads ${members.map(labelOf).join(", ")}`;
  }

  // A workspace alone that several tools share names none of them.
  if (matches.length > 1 && named.provider === undefined) {
    return `scope names ${matches.length} workspaces (${matches.map(labelOf).join(", ")}): add scope.provider to pick one`;
  }

  if (takes(tool, "provider")) {
    const provider =
      named.workspace === undefined ? only.provider : labelOf(only);

    return { args: { ...given, provider }, notes: [], tool };
  }

  if (matches.length > 1) {
    return `scope names ${matches.length} workspaces (${matches.map(labelOf).join(", ")}): add scope.workspace to pick one`;
  }

  const listed = await only.tools();
  const own = listed.find((each) => each.name === tool.name);

  return own === undefined
    ? `${tool.name} is not available on ${labelOf(only)}`
    : {
        args: given,
        notes: [`Reads ${labelOf(only)} only, as scope asked.`],
        tool: own,
      };
};

/**
 * The tool and input that read only what `scope` names, or why it cannot.
 * A tool with its own `provider` or `tag` input is given the scope there;
 * any other is run on the one tool of a combined instance the scope names.
 */
export const scoped = async (
  scoping: Scoping,
  tool: OutboundTool,
  args: JsonObject,
  scope: Json | undefined
): Promise<Scoped | string> => {
  if (scope === undefined || scope === null) {
    return { args, notes: [], tool };
  }

  if (!isJsonObject(scope)) {
    return `${tool.name}: scope must be an object with provider, workspace or tag`;
  }

  const named = namedBy(tool.name, scope);

  if (isRefusal(named)) {
    return named;
  }

  if (named.tag !== undefined && !takes(tool, "tag")) {
    return `${tool.name} cannot read by campaign tag, so scope.tag cannot be used with it`;
  }

  const given = named.tag === undefined ? args : { ...args, tag: named.tag };

  if (named.provider === undefined && named.workspace === undefined) {
    return { args: given, notes: [], tool };
  }

  const alone =
    scoping.provider !== "combined" &&
    (named.provider === undefined || named.provider === scoping.provider) &&
    (named.workspace === undefined || named.workspace === scoping.workspaceId);

  if (alone) {
    return { args: given, notes: [], tool };
  }

  return scoping.provider === "combined"
    ? await onMember(scoping, tool, given, named)
    : `This server reads ${labelOf(scoping)} only, so scope ${labelsOf(named)} names nothing it reads`;
};
