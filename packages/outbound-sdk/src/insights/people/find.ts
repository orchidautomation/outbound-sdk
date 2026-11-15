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

/** What the redact plugin masks here, and how a masked value can still be matched. */
interface Lookup {
  readonly masked: readonly Identifier[];
  /** The token redact writes for a value under `hash`; `undefined` when a masked value cannot be matched. */
  readonly hash: ((value: string) => string) | undefined;
}

const lookupOf = (outbound: Outbound): Lookup => {
  const masking = maskingOf(outbound);

  return {
    hash: masking?.strategy === "hash" ? masking.hash : undefined,
    masked: (masking?.fields ?? []).flatMap((field) =>
      field === "email" || field === "linkedin" ? [field] : []
    ),
  };
};

const WORDS: Readonly<Record<Identifier, string>> = {
  email: "email addresses",
  linkedin: "LinkedIn profiles",
};

const maskedWords = (masked: readonly Identifier[]): string =>
  masked.map((kind) => WORDS[kind]).join(" and ");

const refuse = (
  outbound: Outbound,
  masked: readonly Identifier[],
  why: string
) =>
  new OutboundError(
    "Unsupported",
    `A person cannot be looked up while the redact plugin masks ${maskedWords(masked)}: ${why}`,
    { provider: outbound.provider }
  );

/** A lead ref, as the other people insights return, rather than an identifier. */
export const isLeadRef = (identifier: string): boolean =>
  personKey(identifier) === null && parseRef(identifier.trim()) !== null;

const PROFILE = "https://www.linkedin.com/in/";

/**
 * The forms a record's field may hold an identifier in, to hash: the address,
 * or a profile as given and in its usual URL forms. The first is the one shown.
 */
const formsOf = (key: string, given: string): string[] => {
  const value = key.slice(key.indexOf(":") + 1);

  return kindOf(key) === "email"
    ? [value]
    : [
        `${PROFILE}${value}`,
        `${PROFILE}${value}/`,
        `https://linkedin.com/in/${value}`,
        given.trim(),
      ];
};

interface Start {
  readonly keys: readonly string[];
  readonly records: readonly Lead[];
  /** The tokens a hashed record holds for the identifier given, and the key to show for it. */
  readonly hashed: {
    readonly tokens: ReadonlySet<string>;
    readonly shown: string;
  } | null;
}

/** The identifiers to look the person up by, and the lead a ref names. */
const startFrom = async (
  context: InsightContext,
  identifier: string,
  { hash, masked }: Lookup
): Promise<Start> => {
  const { outbound } = context;
  const key = personKey(identifier);

  if (key !== null) {
    if (!masked.includes(kindOf(key))) {
      return { hashed: null, keys: [key], records: [] };
    }

    // The records come back masked, so an identifier of a masked kind would
    // match none of them: refuse instead of reporting a known person as not
    // found. A hashed record is matched by hashing the identifier the same way.
    if (hash === undefined) {
      throw refuse(
        outbound,
        masked,
        "the records could not be matched to the identifier"
      );
    }

    const tokens = formsOf(key, identifier).map(hash);

    return {
      hashed: {
        shown: `${kindOf(key)}:${tokens[0] ?? ""}`,
        tokens: new Set(tokens),
      },
      keys: [key],
      records: [],
    };
  }

  if (!isLeadRef(identifier)) {
    throw new OutboundError(
      "Invalid",
      "Give an email address, a LinkedIn profile URL or a lead ref",
      { provider: outbound.provider }
    );
  }

  const instead =
    hash === undefined
      ? null
      : "a lead's identifiers are hashed on its record, so give the email address or LinkedIn profile URL instead";

  if (masked.length === 2) {
    throw refuse(
      outbound,
      masked,
      instead ?? "a lead ref has no identifier left to look the person up by"
    );
  }

  const lead = context.one(await outbound.leads.get(identifier.trim()));

  // A ref is looked up by the lead's address, or else its profile, whichever is not masked.
  const keys = keysOfLead(lead).filter(
    (each) => !masked.includes(kindOf(each))
  );

  if (keys.length === 0 && masked.length > 0) {
    const other = (["email", "linkedin"] as const).find(
      (kind) => !masked.includes(kind)
    );

    throw refuse(
      outbound,
      masked,
      instead ??
        `the lead has no ${other === "email" ? "email address" : "LinkedIn profile"} to look it up by`
    );
  }

  return { hashed: null, keys, records: [lead] };
};

/** Whether a record carries the identifier asked for: exactly, or as its hash. */
const carries = (lead: Lead, key: string, start: Start): boolean => {
  if (start.hashed !== null && start.keys.includes(key)) {
    const field = kindOf(key) === "email" ? lead.email : lead.linkedinUrl;

    return field !== null && start.hashed.tokens.has(field);
  }

  return keysOfLead(lead).includes(key);
};

/**
 * Asks the vendor for the person by each identifier. A record that carries a
 * second identifier is looked up under that one too, so an email address can
 * lead to a LinkedIn record. A lead ref is read first (`leads.get`) for its
 * identifiers. Needs `leads.lookup`. While redact masks one kind of
 * identifier the person is looked up by the other, and records found only
 * under the masked one are missed, which the answer says. Under a hashing
 * redact the identifier given is hashed the same way to match the records.
 */
export const findPerson = async (
  context: InsightContext,
  identifier: string,
  maxRecords: number
): Promise<FoundPerson> => {
  const lookup = lookupOf(context.outbound);
  const { masked } = lookup;
  const start = await startFrom(context, identifier, lookup);

  if (masked.length > 0) {
    context.partial(
      `The redact plugin masks ${maskedWords(masked)}, so records found only under that identifier were not linked.`
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
        {
          input: "max_campaigns",
          max: maxRecords,
          what: "records of the person",
        }
      )
    );

    for (const [index, leads] of answers.entries()) {
      const asking = round[index];

      for (const lead of leads) {
        const leadKeys = keysOfLead(lead);

        // Only an exact identifier links two records; the vendor's own matching is not trusted.
        if (asking !== undefined && carries(lead, asking, start)) {
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

  // A hashed identifier is shown as the records show it, never as given.
  const shown = [...keys].map((key) =>
    start.hashed !== null && start.keys.includes(key) ? start.hashed.shown : key
  );

  return {
    keys: shown.toSorted(),
    records: [...records.values()].slice(0, maxRecords),
  };
};
