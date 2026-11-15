// Finding one person's lead records across campaigns and tools, by exact
// identifier. Shared by the people insights.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { profileSlug } from "../../internal/url.ts";
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

interface Redacted {
  readonly redacted: { readonly fields: readonly string[] };
}

type Outbound = InsightContext["outbound"];

// The redact plugin says what it masks on the instance. Told apart by shape,
// so the insights do not import that plugin.
const isRedacted = (outbound: Outbound): outbound is Outbound & Redacted =>
  "redacted" in outbound;

const maskedIdentifiers = (outbound: Outbound): string[] =>
  isRedacted(outbound)
    ? outbound.redacted.fields.filter(
        (field) => field === "email" || field === "linkedin"
      )
    : [];

/**
 * Asks the vendor for the person by each identifier. A record that carries a
 * second identifier is looked up under that one too, so an email address can
 * lead to a LinkedIn record. Needs `leads.lookup`.
 */
export const findPerson = async (
  context: InsightContext,
  identifier: string,
  maxRecords: number
): Promise<FoundPerson> => {
  const first = personKey(identifier);

  if (first === null) {
    throw new OutboundError(
      "Invalid",
      "Give an email address or a LinkedIn profile URL",
      { provider: context.outbound.provider }
    );
  }

  // The records come back masked, so the identifier asked for would match
  // none of them: refuse instead of reporting a known person as not found.
  const masked = maskedIdentifiers(context.outbound);

  if (masked.length > 0) {
    throw new OutboundError(
      "Unsupported",
      `A person cannot be looked up while the redact plugin masks ${masked.join(" and ")}: the records could not be matched to the identifier`,
      { provider: context.outbound.provider }
    );
  }

  const keys = new Set([first]);
  const asked = new Set<string>();
  const records = new Map<string, Lead>();

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

          for (const key of leadKeys) {
            keys.add(key);
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
