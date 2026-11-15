// A vendor with no field for a job title, a LinkedIn profile or a phone
// number often still holds one, in a custom field the account named itself.
// The SDK never guesses which: the caller says, and the adapter then reads
// the custom field wherever the vendor's own field is empty.

import type { Adapter } from "./adapter.ts";
import type { Lead } from "./entities.ts";
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
 * `{ title: "job_title" }`. The name is matched exactly.
 */
export type LeadFieldMap = Readonly<Partial<Record<Mappable, string>>>;

/** `lead` with each mapped field the vendor left empty read from `custom`. */
export const fillFromCustom = (lead: Lead, map: LeadFieldMap): Lead => {
  const filled: Partial<Record<Mappable, string>> = {};

  for (const field of MAPPABLE) {
    const name = map[field];
    const value = name === undefined ? undefined : lead.custom[name]?.trim();

    if (lead[field] === null && value !== undefined && value !== "") {
      filled[field] = value;
    }
  }

  return { ...lead, ...filled };
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
