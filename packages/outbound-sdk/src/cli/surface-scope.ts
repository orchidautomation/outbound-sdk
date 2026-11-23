// The `scope` input every listed tool takes: one provider or workspace of
// what the server reads and, on a tool that takes a campaign scope, which of
// its campaigns: by id, tag or name.

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

/** A tool's campaign scope inputs, listed once under `scope` instead of on their own. */
export const CAMPAIGN_KEYS = ["campaign_ids", "campaign_name", "tag"] as const;

const CAMPAIGN_BY = {
  campaign_ids: "id",
  campaign_name: "name",
  tag: "tag",
} as const satisfies Record<(typeof CAMPAIGN_KEYS)[number], string>;

const SCOPE_KEYS: readonly string[] = [
  "provider",
  "workspace",
  ...CAMPAIGN_KEYS,
];

const isCampaignKey = (name: string): name is (typeof CAMPAIGN_KEYS)[number] =>
  Object.hasOwn(CAMPAIGN_BY, name);

/** Whether the tool takes a campaign scope. */
export const takesCampaigns = (tool: OutboundTool): boolean =>
  CAMPAIGN_KEYS.some((key) => takes(tool, key));

/** `properties` without the campaign scope inputs that `scope` lists. */
export const unscoped = (
  properties: Readonly<Record<string, Json>>
): Record<string, Json> =>
  Object.fromEntries(
    Object.entries(properties).filter(([name]) => !isCampaignKey(name))
  );

// Kept small, since every tool lists it: initialize says what each key
// takes. A tool with a campaign scope lists only the keys' names, which keeps
// tools/list under its ceiling.
export const scopeField = (campaigns: boolean): Json =>
  campaigns
    ? { propertyNames: { enum: [...SCOPE_KEYS] }, type: "object" }
    : {
        properties: {
          provider: { type: "string" },
          workspace: { type: "string" },
        },
        type: "object",
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
  /** The campaign scope inputs given, passed on to the tool as they are. */
  readonly campaigns: JsonObject;
}

const isIdList = (value: Json): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((each) => isString(each) && each.trim() !== "");

// What `scope` names, or why it cannot be read.
const namedBy = (name: string, scope: JsonObject): Named | string => {
  const stray = Object.keys(scope).find((key) => !SCOPE_KEYS.includes(key));

  if (stray !== undefined) {
    return `${name}: scope takes ${SCOPE_KEYS.slice(0, -1).join(", ")} and tag, not ${stray}`;
  }

  const provider = textOf(scope["provider"], "provider");
  const workspace = textOf(scope["workspace"], "workspace");
  const campaignName = textOf(scope["campaign_name"], "campaign_name");
  const tag = textOf(scope["tag"], "tag");

  for (const problem of [provider, workspace, campaignName, tag]) {
    if (problem instanceof Error) {
      return `${name}: ${problem.message}`;
    }
  }

  const ids = scope["campaign_ids"];

  if (ids !== undefined && ids !== null && !isIdList(ids)) {
    return `${name}: scope.campaign_ids must be a non-empty list of campaign ids`;
  }

  const campaigns: Record<string, Json> = {};

  if (ids !== undefined && ids !== null) {
    campaigns["campaign_ids"] = ids;
  }

  if (campaignName !== undefined && !(campaignName instanceof Error)) {
    campaigns["campaign_name"] = campaignName;
  }

  if (tag !== undefined && !(tag instanceof Error)) {
    campaigns["tag"] = tag;
  }

  // SAFETY: each was checked above to be a string or undefined.
  return { campaigns, provider, workspace } as Named;
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
 * A tool with its own `provider` input, or its own campaign scope inputs,
 * is given the scope there;
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
    return `${tool.name}: scope must be an object with ${SCOPE_KEYS.join(", ")}`;
  }

  const named = namedBy(tool.name, scope);

  if (isRefusal(named)) {
    return named;
  }

  const untaken = CAMPAIGN_KEYS.find(
    (key) => Object.hasOwn(named.campaigns, key) && !takes(tool, key)
  );

  if (untaken !== undefined) {
    return `${tool.name} cannot read by campaign ${CAMPAIGN_BY[untaken]}, so scope.${untaken} cannot be used with it`;
  }

  const given = { ...args, ...named.campaigns };

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
