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
 * Whether `value` names a record by ref or id rather than by name. On an
 * instance whose id form is not known (a test adapter, your own adapter) any
 * text without a space is taken as an id, as before names were accepted. A
 * combined instance takes only refs, so anything else there is a name.
 */
export const isIdentifier = (outbound: OutboundApi, value: string): boolean => {
  if (parseRef(value) !== null) {
    return true;
  }

  const form = ID_FORMS.get(outbound.provider);

  if (form !== undefined) {
    return form.test(value);
  }

  return outbound.provider !== "combined" && !/\s/u.test(value);
};

interface Named {
  readonly name: string | null;
  readonly ref: string;
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
 * The ref of the one record named `name`: an exact name match, ignoring case
 * and outer spaces, or else the only name that contains it. Two or more
 * matches are refused with the candidates, never guessed.
 */
const pick = (
  records: readonly Named[],
  name: string,
  what: string
): string => {
  const wanted = name.trim().toLowerCase();
  const nameOf = (record: Named) => (record.name ?? "").trim().toLowerCase();
  const exact = records.filter((record) => nameOf(record) === wanted);

  const matches =
    exact.length > 0
      ? exact
      : records.filter((record) => nameOf(record).includes(wanted));

  const [only] = matches;

  if (only === undefined) {
    throw new OutboundError(
      "NotFound",
      `No ${what} is named "${name}". Give its ref or id, or list the ${what}s to find it`
    );
  }

  if (matches.length > 1) {
    throw new OutboundError(
      "Invalid",
      `${matches.length} ${what}s match "${name}": ${listed(matches)}. Give the full name or the ref`
    );
  }

  return only.ref;
};

/** Reads a whole listing. An insight passes its own, which counts the requests. */
export type ReadAll = <Item>(walk: ListAll<Item>) => Promise<Item[]>;

const toArray: ReadAll = (walk) => walk.toArray();

const resolve = async (
  outbound: OutboundApi,
  value: string,
  what: string,
  records: () => Promise<Named[]>
): Promise<string> =>
  isIdentifier(outbound, value) ? value : pick(await records(), value, what);

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
