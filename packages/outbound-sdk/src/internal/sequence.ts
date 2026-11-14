// Small pieces every adapter needs when it maps a sequence, a step's stats
// or a message's place in a sequence.

import type { SequenceVariant } from "./entities.ts";
import { count } from "./json.ts";
import type { Json } from "./json.ts";
import { stableId } from "./sha256.ts";

/** The key of a variant the vendor does not label: 0 is "A", 1 is "B". */
export const variantKey = (index: number): string =>
  String.fromCodePoint(65 + index);

/**
 * One variant of a step. `contentHash` is a hash of subject and body, so
 * stats can tell old copy from new.
 */
export const toVariant = (
  subject: string | null,
  body: string | null,
  key: string
): SequenceVariant => ({
  body,
  contentHash: stableId(subject, body),
  subject,
  variantKey: key,
});

/**
 * A step or variant the vendor numbers from 1, as an index from 0. `null`
 * when the value is not a number of 1 or more.
 */
export const fromOne = (value: Json | undefined): number | null => {
  const number = count(value);

  return number === null || number < 1 ? null : number - 1;
};
