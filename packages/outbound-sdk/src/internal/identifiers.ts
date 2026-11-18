// Which exact identifiers each tool on an instance fills on its leads. Two
// records are linked only by an identifier both carry, so a tool that fills
// no identifier another tool fills can never be linked to it: an overlap of 0
// there means the link cannot be told, not that nobody is in both.

import type { Lead } from "./entities.ts";
import type { OutboundApi } from "./outbound/api.ts";

export type IdentifierType = "email" | "linkedin";

const TYPES: readonly IdentifierType[] = ["email", "linkedin"];

const FIELD = { email: "email", linkedin: "linkedinUrl" } as const;

export interface ToolIdentifiers {
  readonly provider: string;
  readonly workspaceId: string;
  /** The identifier types the tool fills on its leads, from the vendor or a mapped custom field. */
  readonly identifiers: readonly IdentifierType[];
}

export interface IdentifierCoverage {
  readonly tools: readonly ToolIdentifiers[];
  /**
   * The identifier types two or more tools fill: what a person can be linked
   * across tools by. Empty means no one can be linked across tools.
   */
  readonly shared: readonly IdentifierType[];
}

const ofTool = (outbound: OutboundApi): ToolIdentifiers => ({
  identifiers: TYPES.filter(
    (type) => (outbound.fields.lead[FIELD[type]] ?? false) !== false
  ),
  provider: outbound.provider,
  workspaceId: outbound.workspaceId,
});

const sharedOf = (
  tools: readonly { readonly identifiers: readonly IdentifierType[] }[]
): IdentifierType[] =>
  TYPES.filter(
    (type) => tools.filter((tool) => tool.identifiers.includes(type)).length > 1
  );

/**
 * What each tool on the instance can be linked by, from the fields it
 * declares. No request is made: a combined instance lists its tools itself.
 */
export const identifierCoverage = async (
  outbound: OutboundApi
): Promise<IdentifierCoverage> => {
  if (outbound.provider !== "combined") {
    const tools = [ofTool(outbound)];

    return { shared: sharedOf(tools), tools };
  }

  const { items } = await outbound.workspaces.list();

  const tools = items.map((tool) =>
    ofTool(outbound.workspace(`${tool.provider}:${tool.workspaceId}`))
  );

  return { shared: sharedOf(tools), tools };
};

/** The identifier type of a person key such as `email:a@b.co`, or `null`. */
export const typeOfKey = (key: string): IdentifierType | null =>
  TYPES.find((type) => key.startsWith(`${type}:`)) ?? null;

/**
 * Whether one tool on the instance holds the person. `linked`: it has a
 * record for them. `absent`: it fills an identifier type the person has and
 * no record carries it. `undetermined`: it fills none of the person's
 * identifier types, so whether they are in it cannot be told.
 */
export interface PersonLink extends ToolIdentifiers {
  readonly status: "absent" | "linked" | "undetermined";
}

/** Each tool's link to the person behind `keys`, given the records found. */
export const linksOf = (
  coverage: IdentifierCoverage,
  keys: Iterable<string>,
  records: readonly Lead[]
): PersonLink[] => {
  const types = new Set([...keys].map(typeOfKey));

  return coverage.tools.map((tool) => {
    if (
      records.some(
        (record) =>
          record.provider === tool.provider &&
          record.workspaceId === tool.workspaceId
      )
    ) {
      return { ...tool, status: "linked" };
    }

    return {
      ...tool,
      status: tool.identifiers.some((type) => types.has(type))
        ? "absent"
        : "undetermined",
    };
  });
};

/** The sentence an answer gives for a tool whose link to the person cannot be told. */
export const undeterminedNote = (link: ToolIdentifiers): string =>
  `${link.provider} (${link.workspaceId}) fills ${link.identifiers.length === 0 ? "no identifier" : link.identifiers.join(" and ")} on its leads and the person has none of that, so whether they are in it cannot be told. Map a custom field with leadFields to link it.`;

export interface ToolLeadIdentifiers extends ToolIdentifiers {
  /** Leads read from the tool. */
  readonly leads: number;
  /** Of those, how many carry each identifier type. */
  readonly carrying: Readonly<Record<IdentifierType, number>>;
}

export interface LeadIdentifierCoverage {
  readonly tools: readonly ToolLeadIdentifiers[];
  /** The identifier types leads of two or more tools actually carry. Empty means the leads cannot be linked across tools. */
  readonly shared: readonly IdentifierType[];
}

/**
 * What a set of leads can be linked by, counted from the leads themselves: a
 * tool can declare a field and still leave it empty on every lead, as
 * HeyReach does with email addresses it has not enriched.
 */
export const leadIdentifierCoverage = (
  leads: readonly Lead[]
): LeadIdentifierCoverage => {
  const tools = new Map<string, ToolLeadIdentifiers>();

  for (const lead of leads) {
    const key = `${lead.provider}:${lead.workspaceId}`;

    const before = tools.get(key) ?? {
      carrying: { email: 0, linkedin: 0 },
      identifiers: [],
      leads: 0,
      provider: lead.provider,
      workspaceId: lead.workspaceId,
    };

    const carrying = {
      email: before.carrying.email + (lead.email === null ? 0 : 1),
      linkedin: before.carrying.linkedin + (lead.linkedinUrl === null ? 0 : 1),
    };

    tools.set(key, {
      ...before,
      carrying,
      identifiers: TYPES.filter((type) => carrying[type] > 0),
      leads: before.leads + 1,
    });
  }

  const listed = [...tools.values()];

  return { shared: sharedOf(listed), tools: listed };
};
