// outbound-sdk/identity: the same person in several tools.
//
// Adds `personKey` to every lead, and `outbound.person(key)`, which returns
// every record for that person and one timeline across tools. Records are
// linked, never merged: each keeps its own provider, workspace and fields.

import { mapConcurrent } from "../internal/concurrency.ts";
import type { Lead, Message } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Include, OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { keysOf, toKey } from "./keys.ts";

export interface PersonLead extends Lead {
  /** The lead's primary exact identifier, or `null` when it has none. */
  readonly personKey: string | null;
  /** Every exact identifier the lead carries. */
  readonly personKeys: readonly string[];
}

export interface PersonOptions {
  /** Look only in these campaigns (refs). Without it, the vendor is asked for the person when it can find one by identifier, and every lead is scanned otherwise. */
  readonly campaignIds?: readonly string[] | undefined;
  /** Leave the timeline out, which saves a request per matching record. */
  readonly timeline?: boolean | undefined;
  /** What to ask for on the timeline's messages, for example `["body"]`. */
  readonly include?: readonly Include[] | undefined;
}

export interface Person {
  /** The key that was looked up. */
  readonly key: string;
  /** Every exact identifier found on the matching records. */
  readonly keys: readonly string[];
  /** `false` when no record carries the key: the link is unknown, not absent. */
  readonly found: boolean;
  /** One record per tool or campaign the person is in. Linked, not merged. */
  readonly records: readonly Lead[];
  /** Every message to and from the person across tools, oldest first. */
  readonly timeline: readonly Message[];
}

export interface IdentityExtension {
  readonly person: (
    identifier: string,
    options?: PersonOptions
  ) => Promise<Person>;
}

const isLead = (record: OutboundRecord): record is Lead =>
  "custom" in record && "email" in record;

const withKeys = (record: OutboundRecord): OutboundRecord => {
  if (!isLead(record)) {
    return record;
  }

  const personKeys = keysOf(record);

  const tagged: PersonLead = {
    ...record,
    personKey: personKeys[0] ?? null,
    personKeys,
  };

  return tagged;
};

// Leads are walked from the global list when the vendor has one, and campaign
// by campaign otherwise.
const scanLeads = async function* scanLeads(
  outbound: OutboundApi,
  options: PersonOptions
): AsyncGenerator<Lead> {
  if (
    options.campaignIds === undefined &&
    outbound.capabilities["leads.list"]
  ) {
    yield* outbound.leads.listAll();

    return;
  }

  const campaigns =
    options.campaignIds === undefined
      ? await outbound.campaigns.listAll().toArray()
      : [];

  const campaignIds =
    options.campaignIds ?? campaigns.map((campaign) => campaign.ref);

  for (const campaignId of campaignIds) {
    yield* outbound.campaign(campaignId).leads.listAll();
  }
};

const collect = async (
  outbound: OutboundApi,
  options: PersonOptions,
  keys: Set<string>,
  found: Map<string, Lead>
): Promise<boolean> => {
  let grew = false;

  for await (const lead of scanLeads(outbound, options)) {
    const leadKeys = keysOf(lead);

    if (!found.has(lead.ref) && leadKeys.some((key) => keys.has(key))) {
      found.set(lead.ref, lead);

      for (const key of leadKeys) {
        grew ||= !keys.has(key);
        keys.add(key);
      }
    }
  }

  return grew;
};

const filterFor = (key: string): { email: string } | { linkedinUrl: string } =>
  key.startsWith("email:")
    ? { email: key.slice("email:".length) }
    : {
        linkedinUrl: `https://www.linkedin.com/in/${key.slice("linkedin:".length)}`,
      };

/**
 * Asks the vendor for the person by each identifier, instead of walking every
 * lead. A record that carries a second identifier is looked up under that one
 * too, so an email can lead to a LinkedIn record and back.
 */
const find = async (
  outbound: OutboundApi,
  keys: Set<string>,
  found: Map<string, Lead>
): Promise<void> => {
  const asked = new Set<string>();

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
      outbound.leads.listAll(filterFor(key)).toArray()
    );

    for (const [index, leads] of answers.entries()) {
      const asking = round[index];

      for (const lead of leads) {
        const leadKeys = keysOf(lead);

        // The vendor's own matching is not trusted: only an exact key links.
        if (asking !== undefined && leadKeys.includes(asking)) {
          // One record per campaign: a vendor can use one lead id in all of them.
          found.set(`${lead.ref} ${lead.campaignRef ?? ""}`, lead);

          for (const key of leadKeys) {
            keys.add(key);
          }
        }
      }
    }
  }
};

interface Redacted {
  readonly redacted: { readonly fields: readonly string[] };
}

// The redact plugin says what it masks on the instance. Told apart by shape,
// so this plugin does not import that one.
const isRedacted = (
  outbound: OutboundApi
): outbound is OutboundApi & Redacted => "redacted" in outbound;

const IDENTIFIER_FIELDS: ReadonlySet<string> = new Set(["email", "linkedin"]);

/**
 * person() matches on the email address and the profile URL of the records it
 * reads through the instance. With either masked it would link nothing and
 * report a person it cannot see as not found, so it refuses instead.
 */
const assertIdentifiersReadable = (outbound: OutboundApi): void => {
  const masked = isRedacted(outbound)
    ? outbound.redacted.fields.filter((field) => IDENTIFIER_FIELDS.has(field))
    : [];

  if (masked.length > 0) {
    throw new OutboundError(
      "Unsupported",
      `person() is not available: the redact plugin masks ${masked.join(" and ")}, so records cannot be linked by identifier. Use an instance without redact, or leave "email" and "linkedin" out of its fields`,
      { provider: outbound.provider }
    );
  }
};

const bySentAt = (left: Message, right: Message): number =>
  (left.sentAt ?? "").localeCompare(right.sentAt ?? "");

const lookup = async (
  outbound: OutboundApi,
  identifier: string,
  options: PersonOptions
): Promise<Person> => {
  const key = toKey(identifier);

  if (key === null) {
    throw new OutboundError(
      "Invalid",
      "person() needs a person key, an email address or a LinkedIn profile URL"
    );
  }

  assertIdentifiersReadable(outbound);

  const keys = new Set([key]);
  const found = new Map<string, Lead>();

  if (
    outbound.capabilities["leads.lookup"] &&
    options.campaignIds === undefined
  ) {
    await find(outbound, keys, found);
  } else if (await collect(outbound, options, keys, found)) {
    // A record that links two identifiers (an email and a profile) can reveal
    // records seen earlier under the other one, so scan again when that happens.
    await collect(outbound, options, keys, found);
  }

  const records = [...found.values()];

  const wantsTimeline =
    (options.timeline ?? true) && outbound.capabilities["leads.timeline"];

  const timelines = wantsTimeline
    ? await Promise.all(
        records.map((record) =>
          outbound.lead(record.ref).timeline({ include: options.include })
        )
      )
    : [];

  return {
    found: records.length > 0,
    key,
    keys: [...keys].toSorted(),
    records,
    timeline: timelines.flatMap((page) => page.items).toSorted(bySentAt),
  };
};

/** Links the same person across tools by exact identifier. */
export const identity = (): OutboundPlugin<IdentityExtension> => ({
  extend: (outbound) => ({
    person: (identifier, options = {}) => lookup(outbound, identifier, options),
  }),
  name: "identity",
  wrap: async (operation, next) => {
    const output = await next(operation);

    return { ...output, items: output.items.map(withKeys) };
  },
});
