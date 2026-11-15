// Finding one person's lead records across campaigns and tools, by exact
// identifier. Shared by the people insights.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { parseRef } from "../../internal/ref.ts";
import { profileSlug } from "../../internal/url.ts";
import { maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";

/** `email:<address>` or `linkedin:<slug>`, or `null` when the text is neither. */
export const personKey = (identifier: string): string | null => {
  const value = identifier.trim();
  const slug = profileSlug(value);

  if (slug !== null) {
    return `linkedin:${slug}`;
  }

  return value.includes("@") && !value.includes(" ")
    ? `email:${value.toLowerCase()}`
    : null;
};

/** Every exact identifier a lead carries. */
export const keysOfLead = (lead: Lead): string[] => {
  const slug = profileSlug(lead.linkedinUrl);

  return [
    ...(lead.email === null ? [] : [`email:${lead.email}`]),
    ...(slug === null ? [] : [`linkedin:${slug}`]),
  ];
};

const filterFor = (key: string): { email: string } | { linkedinUrl: string } =>
  key.startsWith("email:")
    ? { email: key.slice("email:".length) }
    : {
        linkedinUrl: `https://www.linkedin.com/in/${key.slice("linkedin:".length)}`,
      };

export interface FoundPerson {
  /** Every identifier the matching records carry, sorted. */
  readonly keys: readonly string[];
  /** One record per campaign the person is in. */
  readonly records: readonly Lead[];
}

type Outbound = InsightContext["outbound"];

type Identifier = "email" | "linkedin";

const kindOf = (key: string): Identifier =>
  key.startsWith("email:") ? "email" : "linkedin";

/** The person identifiers the redact plugin masks here. */
const maskedIdentifiers = (outbound: Outbound): Identifier[] =>
  (maskingOf(outbound)?.fields ?? []).flatMap((field) =>
    field === "email" || field === "linkedin" ? [field] : []
  );

const WORDS: Readonly<Record<Identifier, string>> = {
  email: "email addresses",
  linkedin: "LinkedIn profiles",
};

const refuse = (outbound: Outbound, masked: readonly Identifier[]) =>
  new OutboundError(
    "Unsupported",
    `A person cannot be looked up while the redact plugin masks ${masked.map((kind) => WORDS[kind]).join(" and ")}: the records could not be matched to the identifier`,
    { provider: outbound.provider }
  );

/** A lead ref, as the other people insights return, rather than an identifier. */
export const isLeadRef = (identifier: string): boolean =>
  personKey(identifier) === null && parseRef(identifier.trim()) !== null;

interface Start {
  readonly keys: readonly string[];
  readonly records: readonly Lead[];
}

/** The identifiers to look the person up by, and the lead a ref names. */
const startFrom = async (
  context: InsightContext,
  identifier: string,
  masked: readonly Identifier[]
): Promise<Start> => {
  const { outbound } = context;
  const key = personKey(identifier);

  if (key !== null) {
    // The records come back masked, so an identifier of a masked kind would
    // match none of them: refuse instead of reporting a known person as not found.
    if (masked.includes(kindOf(key))) {
      throw refuse(outbound, masked);
    }

    return { keys: [key], records: [] };
  }

  if (!isLeadRef(identifier)) {
    throw new OutboundError(
      "Invalid",
      "Give an email address, a LinkedIn profile URL or a lead ref",
      { provider: outbound.provider }
    );
  }

  if (masked.length > 0) {
    throw refuse(outbound, masked);
  }

  const lead = context.one(await outbound.leads.get(identifier.trim()));

  return { keys: keysOfLead(lead), records: [lead] };
};

/**
 * Asks the vendor for the person by each identifier. A record that carries a
 * second identifier is looked up under that one too, so an email address can
 * lead to a LinkedIn record. A lead ref is read first (`leads.get`) for its
 * identifiers. Needs `leads.lookup`. While redact masks one kind of
 * identifier the person is looked up by the other, and records found only
 * under the masked one are missed, which the answer says.
 */
export const findPerson = async (
  context: InsightContext,
  identifier: string,
  maxRecords: number
): Promise<FoundPerson> => {
  const masked = maskedIdentifiers(context.outbound);
  const start = await startFrom(context, identifier, masked);

  if (masked.length > 0) {
    context.partial(
      `The redact plugin masks ${masked.map((kind) => WORDS[kind]).join(" and ")}, so records found only under that identifier were not linked.`
    );
  }

  const keys = new Set(start.keys);
  const asked = new Set<string>();

  const records = new Map<string, Lead>(
    start.records.map((lead) => [`${lead.ref} ${lead.campaignRef ?? ""}`, lead])
  );

  for (
    let round = [...keys].filter((key) => !asked.has(key));
    round.length > 0;
    round = [...keys].filter((key) => !asked.has(key))
  ) {
    for (const key of round) {
      asked.add(key);
    }

    // Every identifier known so far is asked for at once; an answer can name
    // another identifier, which the next round asks for.
    // oxlint-disable-next-line no-await-in-loop -- each round depends on the identifiers the previous one found.
    const answers = await mapConcurrent(round, (key) =>
      context.all(
        context.outbound.leads.listAll({ ...filterFor(key), max: maxRecords }),
        `${maxRecords} records of the person`
      )
    );

    for (const [index, leads] of answers.entries()) {
      const asking = round[index];

      for (const lead of leads) {
        const leadKeys = keysOfLead(lead);

        // Only an exact identifier links two records; the vendor's own matching is not trusted.
        if (asking !== undefined && leadKeys.includes(asking)) {
          // One record per campaign: a vendor can use one lead id in all of them.
          records.set(`${lead.ref} ${lead.campaignRef ?? ""}`, lead);

          // A masked identifier cannot be asked for or matched.
          for (const key of leadKeys) {
            if (!masked.includes(kindOf(key))) {
              keys.add(key);
            }
          }
        }
      }
    }
  }

  return {
    keys: [...keys].toSorted(),
    records: [...records.values()].slice(0, maxRecords),
  };
};
