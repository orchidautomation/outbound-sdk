// A campaign or list given by name instead of by ref or id. Every tool, every
// insight and the CLI take a `campaign` the same way: a ref or a vendor id is
// used as given, at no cost; anything that cannot be an id of this vendor is
// looked up by name, which reads the whole listing once.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import type { ListAll, OutboundApi } from "../internal/outbound/api.ts";
import { parseRef } from "../internal/ref.ts";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

const DIGITS = /^\d+$/u;

/**
 * The form of a campaign or list id at each vendor, from the vendor's API
 * reference (docs/research/<provider>.md): Instantly ids are UUIDs, and
 * Smartlead, EmailBison and HeyReach ids are numbers. Text of another form
 * would be refused by the vendor, so it is read as a name.
 */
const ID_FORMS: ReadonlyMap<string, RegExp> = new Map([
  ["emailbison", DIGITS],
  ["heyreach", DIGITS],
  ["instantly", UUID],
  ["smartlead", DIGITS],
]);

/**
 * Whether `value` is surely a ref or an id, so it is used with no lookup: a
 * ref, an id in the vendor's documented form, or, on an instance whose id
 * form is not known (a test adapter, your own adapter), any text without a
 * space, as before names were accepted.
 */
export const isIdentifier = (outbound: OutboundApi, value: string): boolean => {
  if (parseRef(value) !== null) {
    return true;
  }

  const form = ID_FORMS.get(outbound.provider);

  return form === undefined ? !/\s/u.test(value) : form.test(value);
};

interface Named {
  readonly name: string | null;
  readonly ref: string;
  readonly sourceId: string;
}

/** How many candidates an ambiguous name lists. */
const SHOWN = 10;

const listed = (matches: readonly Named[]): string => {
  const shown = matches
    .slice(0, SHOWN)
    .map((match) => `"${match.name ?? ""}" (${match.ref})`)
    .join(", ");

  return matches.length > SHOWN
    ? `${shown} and ${matches.length - SHOWN} more`
    : shown;
};

/**
 * What `value` names among `records`: a record whose id it is, used as given;
 * else the record whose name it is, ignoring case and outer spaces, or the
 * only one whose name contains it; else `undefined`. Two or more names that
 * match are refused with the candidates, never guessed.
 */
const pick = (
  records: readonly Named[],
  value: string,
  what: string
): string | undefined => {
  if (records.some((record) => record.sourceId === value)) {
    return value;
  }

  const wanted = value.trim().toLowerCase();
  const nameOf = (record: Named) => (record.name ?? "").trim().toLowerCase();
  const exact = records.filter((record) => nameOf(record) === wanted);

  const matches =
    exact.length > 0
      ? exact
      : records.filter((record) => nameOf(record).includes(wanted));

  if (matches.length > 1) {
    throw new OutboundError(
      "Invalid",
      `${matches.length} ${what}s match "${value}": ${listed(matches)}. Give the full name or the ref`
    );
  }

  return matches[0]?.ref;
};

/** Reads a whole listing. An insight passes its own, which counts the requests. */
export type ReadAll = <Item>(walk: ListAll<Item>) => Promise<Item[]>;

const toArray: ReadAll = (walk) => walk.toArray();

/**
 * `value` as given when it is surely an id; else what the listing says it
 * names. Nothing found is refused here only where the vendor would refuse it
 * too, text that cannot be its id; elsewhere it is passed on as an id, as
 * before names were accepted.
 */
const resolve = async (
  outbound: OutboundApi,
  value: string,
  what: string,
  records: () => Promise<Named[]>
): Promise<string> => {
  if (isIdentifier(outbound, value)) {
    return value;
  }

  const found = pick(await records(), value, what);

  if (found !== undefined) {
    return found;
  }

  if (ID_FORMS.has(outbound.provider) || outbound.provider === "combined") {
    throw new OutboundError(
      "NotFound",
      `No ${what} has the id or name "${value}". Give its ref or id, or list the ${what}s to find it`
    );
  }

  return value;
};

/** A campaign's ref or id as given, or the ref of the campaign it names. */
export const resolveCampaign = (
  outbound: OutboundApi,
  value: string,
  read: ReadAll = toArray
): Promise<string> =>
  resolve(outbound, value, "campaign", () =>
    read(outbound.campaigns.listAll())
  );

/** A lead list's ref or id as given, or the ref of the list it names. */
export const resolveList = (
  outbound: OutboundApi,
  value: string
): Promise<string> =>
  resolve(outbound, value, "list", () => toArray(outbound.lists.listAll()));

// The one field read from any tool's or insight's input.
const withCampaignField = z.looseObject({ campaign: z.string() });

/** Whether the input's `campaign` is a name, which costs a campaign listing to look up. */
export const namesCampaign = <Input>(
  outbound: OutboundApi,
  input: Input
): boolean => {
  const parsed = withCampaignField.safeParse(input);

  return parsed.success && !isIdentifier(outbound, parsed.data.campaign);
};

/** The input with its `campaign`, when it is text, resolved to a ref or id. */
export const withCampaign = async <Input>(
  outbound: OutboundApi,
  input: Input,
  read: ReadAll = toArray
): Promise<Input> => {
  const parsed = withCampaignField.safeParse(input);

  if (!parsed.success) {
    return input;
  }

  const given = parsed.data.campaign;
  const campaign = await resolveCampaign(outbound, given, read);

  // SAFETY: only `campaign` changes, from one string to another.
  return campaign === given ? input : ({ ...parsed.data, campaign } as Input);
};
