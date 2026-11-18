// A vendor with no field for a job title, a LinkedIn profile or a phone
// number often still holds one, in a custom field the account named itself.
// The SDK never guesses which: the caller says, and the adapter then reads
// the custom field wherever the vendor's own field is empty.

import { z } from "zod";

import type { Adapter } from "./adapter.ts";
import type { Lead } from "./entities.ts";
import { OutboundError } from "./errors.ts";
import type { FieldDeclaration } from "./fields.ts";

const MAPPABLE = [
  "company",
  "companyLinkedinUrl",
  "linkedinUrl",
  "location",
  "phone",
  "title",
  "website",
] as const;

type Mappable = (typeof MAPPABLE)[number];

/**
 * A lead field and the name of the custom field that holds it, for example
 * `{ title: "job_title" }`, or several names to try in order, for example
 * `{ linkedinUrl: ["linkedin_profile", "linkedin_url"] }` when an account
 * named the same field differently in different lists. Names are matched
 * exactly, and the first that holds a value is read.
 */
export type LeadFieldMap = Readonly<
  Partial<Record<Mappable, string | readonly string[] | undefined>>
>;

const namesOf = (name: string | readonly string[] | undefined): string[] =>
  name === undefined ? [] : [name].flat();

/** `lead` with each mapped field the vendor left empty read from `custom`. */
export const fillFromCustom = (lead: Lead, map: LeadFieldMap): Lead => {
  const filled: Partial<Record<Mappable, string>> = {};

  for (const field of MAPPABLE) {
    const value = namesOf(map[field])
      .map((name) => lead.custom[name]?.trim())
      .find((each) => each !== undefined && each !== "");

    if (lead[field] === null && value !== undefined) {
      filled[field] = value;
    }
  }

  return { ...lead, ...filled };
};

const names = z.union([
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)).min(1),
]);

/**
 * A lead field map as a config file or an environment variable gives it:
 * each key a mappable field, each value a custom field name or a list of them.
 */
export const leadFieldMapSchema = z.strictObject({
  company: names.optional(),
  companyLinkedinUrl: names.optional(),
  linkedinUrl: names.optional(),
  location: names.optional(),
  phone: names.optional(),
  title: names.optional(),
  website: names.optional(),
});

/** Why a lead field map from `source` failed `leadFieldMapSchema`, in one sentence. */
export const leadFieldsInvalid = (
  source: string,
  error: z.ZodError
): OutboundError => {
  const [issue] = error.issues;
  const [field] = issue?.path ?? [];

  if (issue?.code === "unrecognized_keys") {
    return new OutboundError(
      "Invalid",
      `${source} names "${issue.keys.join('", "')}", which is not a lead field it can fill. Use one of: ${MAPPABLE.join(", ")}`
    );
  }

  return new OutboundError(
    "Invalid",
    field === undefined
      ? `${source} must map lead fields to custom field names, such as { "linkedinUrl": ["linkedin_profile", "linkedin_url"] }`
      : `${source} maps "${String(field)}" to something other than a custom field name or a list of them; give a custom field name or a list of them`
  );
};

type LeadReaders = Pick<Adapter, "getLead" | "listLeads">;

/** The adapter's lead reads, with the mapped fields filled on every lead. */
export const withLeadFields = <Readers extends LeadReaders>(
  readers: Readers,
  map: LeadFieldMap | undefined
): Readers => {
  if (map === undefined || Object.keys(map).length === 0) {
    return readers;
  }

  const { getLead, listLeads } = readers;

  const wrapped: LeadReaders = {
    ...(getLead && {
      getLead: async (id, ctx) => fillFromCustom(await getLead(id, ctx), map),
    }),
    ...(listLeads && {
      listLeads: async (query, ctx) => {
        const page = await listLeads(query, ctx);

        return {
          items: page.items.map((lead) => fillFromCustom(lead, map)),
          next: page.next,
        };
      },
    }),
  };

  return { ...readers, ...wrapped };
};

/**
 * The adapter's field declaration once a map is given: a field it never
 * filled is now worked out from a custom field, so it is `derived`.
 */
export const withMappedFields = (
  declared: FieldDeclaration,
  map: LeadFieldMap | undefined
): FieldDeclaration => {
  const lead = declared.lead === false ? undefined : declared.lead;

  if (map === undefined || lead === undefined) {
    return declared;
  }

  const derived = Object.fromEntries(
    MAPPABLE.flatMap((field) =>
      map[field] !== undefined && lead[field] === false
        ? [[field, "derived"] as const]
        : []
    )
  );

  return { ...declared, lead: { ...lead, ...derived } };
};
