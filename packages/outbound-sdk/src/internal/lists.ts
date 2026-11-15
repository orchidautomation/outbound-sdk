// Strict reads of a vendor's list answers. A 200 whose body is not the list
// the vendor documents (an HTML maintenance page, `{}`, `{ items: null }`)
// is the vendor's fault, so it is a `Provider` error, never zero records.

import { OutboundError } from "./errors.ts";
import { isJsonArray, isJsonObject } from "./json.ts";
import type { Json } from "./json.ts";

/** A vendor list that must be a JSON array. Anything else is a `Provider` error. */
export const requireList = (
  value: Json | undefined,
  provider: string,
  message: string
): Json[] => {
  if (!isJsonArray(value)) {
    throw new OutboundError("Provider", message, { provider });
  }

  return value;
};

export interface ListPlace {
  /** The vendor as a person names it: `Instantly`. */
  readonly vendor: string;
  /** The adapter's provider name, for the error. */
  readonly provider: string;
  /** The request, as the error names it: `/campaigns`. */
  readonly path: string;
  /** The field of the answer that holds the array. Omitted when the answer is the array. */
  readonly key?: string | undefined;
}

/** The message for an answer that is not the documented list. */
export const noListMessage = (place: ListPlace): string =>
  `${place.vendor} returned no list for ${place.path}: expected ${
    place.key === undefined
      ? "a JSON array"
      : `a JSON object with an array in \`${place.key}\``
  }`;

/**
 * The array a vendor answer holds under `place.key`, or the answer itself
 * when it has no key. Anything else is a `Provider` error that says what was
 * expected.
 */
export const listIn = (body: Json | undefined, place: ListPlace): Json[] => {
  let rows = body;

  if (place.key !== undefined) {
    rows = isJsonObject(body) ? body[place.key] : undefined;
  }

  return requireList(rows, place.provider, noListMessage(place));
};
