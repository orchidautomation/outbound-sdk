// personalization_gaps: leads that will get broken copy.

import { z } from "zod";

import type { Lead, Sequence } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import { refOf } from "../ref.ts";
import { rate } from "../stats.ts";
import { leadsOf } from "./read.ts";

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe("The campaign's ref (provider:workspace:id)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(100)
    .describe("How many affected leads to list. The counts cover all of them."),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(500)
    .describe(
      "The most leads to check. A vendor request returns about 50 to 100 leads."
    ),
});

export interface VariableUse {
  /** The step, counted from 0. */
  readonly step: number;
  readonly variant: string;
  readonly field: "body" | "subject";
  readonly fallback: boolean;
}

export interface CopyVariable {
  /** The name as the copy writes it the first time. */
  readonly name: string;
  /**
   * `builtin` for first name, last name, company, title and email; `custom`
   * when a lead read has a custom field of that name; `unknown` when no
   * lead read has it, which is a sender or system variable the tool fills
   * itself, or a field nobody has.
   */
  readonly source: "builtin" | "custom" | "unknown";
  /** `false` when every use has a fallback, or the source is unknown. */
  readonly gap: boolean;
  readonly steps: readonly number[];
  readonly uses: readonly VariableUse[];
  /** Leads read with no value for it. `null` for an unknown variable. */
  readonly leadsWithoutValue: number | null;
  /** Leads who get broken copy from it: 0 when every use has a fallback. `null` for an unknown variable. */
  readonly leadsAffected: number | null;
}

export interface GapLead {
  readonly lead: string;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly status: string;
  /** The variables with no value and no fallback, as the copy writes them. */
  readonly missing: readonly string[];
}

export interface PersonalizationGaps {
  readonly campaign: string;
  /** Most leads affected first. */
  readonly variables: readonly CopyVariable[];
  /** Leads missing at least one variable, most missing first, up to `limit`. */
  readonly leads: readonly GapLead[];
  /** Variables no lead read has a value for and that are not built in. Check them by hand. */
  readonly unknownVariables: readonly string[];
  readonly totals: {
    readonly steps: number;
    readonly variables: number;
    readonly leadsRead: number;
    readonly leadsAffected: number;
    /** Affected leads divided by leads read. `null` when no lead was read. */
    readonly affectedRate: number | null;
  };
}

// `{{name}}` and `{{name|fallback}}`, `{name}`, and `%name%`. A single brace
// holding a `|` is spintax, not a variable, so it never matches.
const PATTERNS = [
  /\{\{\s*(?<name>[^{}|]+?)\s*(?<fallback>\|[^{}]*)?\}\}/gu,
  /(?<!\{)\{(?<name>[A-Za-z_][\w .-]*)\}(?!\})/gu,
  /%(?<name>[A-Za-z_][\w-]*)%/gu,
];

/** Lowercased, without spaces, underscores and hyphens. */
const keyOf = (name: string): string =>
  name.toLowerCase().replaceAll(/[\s_-]/gu, "");

type Builtin = (lead: Lead) => string | null;

const BUILTINS = new Map<string, Builtin>([
  ["company", (lead) => lead.company],
  ["companyname", (lead) => lead.company],
  ["email", (lead) => lead.email],
  ["firstname", (lead) => lead.firstName],
  ["jobtitle", (lead) => lead.title],
  ["lastname", (lead) => lead.lastName],
  ["title", (lead) => lead.title],
]);

interface Found {
  readonly name: string;
  readonly uses: VariableUse[];
}

const FIELDS: readonly ("body" | "subject")[] = ["subject", "body"];

/** Every variable in one text, in the order the patterns find them. */
const variablesIn = (
  text: string
): { readonly name: string; readonly fallback: boolean }[] =>
  PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      fallback: match.groups?.fallback !== undefined,
      name: match.groups?.name ?? "",
    }))
  );

const findVariables = (sequence: Sequence): Map<string, Found> => {
  const found = new Map<string, Found>();

  const texts = sequence.steps.flatMap((step) =>
    step.variants.flatMap((variant) =>
      FIELDS.map((field) => ({
        field,
        step: step.index,
        text: variant[field] ?? "",
        variant: variant.variantKey,
      }))
    )
  );

  for (const { field, step, text, variant } of texts) {
    for (const { fallback, name } of variablesIn(text)) {
      const entry = found.get(keyOf(name)) ?? { name, uses: [] };
      entry.uses.push({ fallback, field, step, variant });
      found.set(keyOf(name), entry);
    }
  }

  return found;
};

const filled = (value: string | null): boolean =>
  value !== null && value.trim() !== "";

/** Every non-empty value a lead has, by normalized variable name. */
const valuesOf = (lead: Lead): Set<string> =>
  new Set([
    ...[...BUILTINS].flatMap(([key, read]) =>
      filled(read(lead)) ? [key] : []
    ),
    ...Object.entries(lead.custom).flatMap(([key, value]) =>
      filled(value) ? [keyOf(key)] : []
    ),
  ]);

const sourceOf = (
  key: string,
  customKeys: ReadonlySet<string>
): CopyVariable["source"] => {
  if (BUILTINS.has(key)) {
    return "builtin";
  }

  return customKeys.has(key) ? "custom" : "unknown";
};

interface Keyed {
  readonly key: string;
  readonly variable: CopyVariable;
}

const toVariable = (
  key: string,
  { name, uses }: Found,
  leads: readonly Set<string>[],
  customKeys: ReadonlySet<string>
): Keyed => {
  const source = sourceOf(key, customKeys);
  const known = source !== "unknown";
  const needed = uses.some((use) => !use.fallback);
  const without = leads.filter((values) => !values.has(key)).length;

  return {
    key,
    variable: {
      gap: known && needed,
      leadsAffected: known ? Number(needed) * without : null,
      leadsWithoutValue: known ? without : null,
      name,
      source,
      steps: [...new Set(uses.map((use) => use.step))].toSorted(
        (left, right) => left - right
      ),
      uses,
    },
  };
};

const missingOf = (
  lead: Lead,
  values: ReadonlySet<string>,
  gaps: readonly Keyed[]
): GapLead[] => {
  const missing = gaps.flatMap((gap) =>
    values.has(gap.key) ? [] : [gap.variable.name]
  );

  return missing.length === 0
    ? []
    : [
        {
          email: lead.email,
          lead: lead.ref,
          linkedinUrl: lead.linkedinUrl,
          missing,
          status: lead.status,
        },
      ];
};

export const personalizationGaps = defineInsight({
  description:
    "Leads in one campaign who will get broken copy because a merge variable has no value for them. Reads the campaign's sequence, finds every {{variable}}, {variable} and %variable% in subjects and bodies, and checks each lead for a value: first name, last name, company, title, email, or a custom field of the same name without regard to case, spaces, underscores or hyphens. Returns the variables with the steps that use them, how many leads each one affects, and the leads missing at least one. A variable with a fallback such as {{firstName|there}} is not a gap. A variable no lead has, such as a sender signature the tool fills in, is listed as unknown, not counted against leads. Costs one request for the sequence plus one per page of leads.",
  inputSchema: input,
  key: "personalizationGaps",
  cost: (values, price) =>
    price.one("sequence.get") +
    price.upTo(1) * price.list("leads.list", values.max_leads),
  scales: "max_leads",
  name: "personalization_gaps",
  needs: ["sequence", "leads.byCampaign"],
  next: "Fix the leads' fields or add a fallback in the tool, then use lead_collisions to check the same leads are not in another campaign.",
  run: async (context, values) => {
    const sequence = context.one(
      await context.outbound.campaign(values.campaign).sequence()
    );

    const found = findVariables(sequence);

    const leads =
      found.size === 0
        ? []
        : await leadsOf(
            context,
            values.campaign,
            values.max_leads,
            "max_leads"
          );

    if (found.size === 0) {
      context.note("The sequence uses no variables, so no lead was read.");
    }

    const customKeys = new Set(
      leads.flatMap((lead) => Object.keys(lead.custom).map(keyOf))
    );

    const keyed = [...found].map(([key, entry]) =>
      toVariable(key, entry, leads.map(valuesOf), customKeys)
    );

    const variables = keyed
      .map((each) => each.variable)
      .toSorted(
        (left, right) =>
          (right.leadsAffected ?? -1) - (left.leadsAffected ?? -1) ||
          left.name.localeCompare(right.name)
      );

    const gaps = keyed.filter((each) => each.variable.gap);

    const affected = leads
      .flatMap((lead) => missingOf(lead, valuesOf(lead), gaps))
      .toSorted(
        (left, right) =>
          right.missing.length - left.missing.length ||
          left.lead.localeCompare(right.lead)
      );

    const answer: PersonalizationGaps = {
      campaign: refOf(context.outbound, values.campaign),
      leads: affected.slice(0, values.limit),
      totals: {
        affectedRate: rate(affected.length, leads.length),
        leadsAffected: affected.length,
        leadsRead: leads.length,
        steps: sequence.steps.length,
        variables: variables.length,
      },
      unknownVariables: variables.flatMap((each) =>
        each.source === "unknown" ? [each.name] : []
      ),
      variables,
    };

    return answer;
  },
});
