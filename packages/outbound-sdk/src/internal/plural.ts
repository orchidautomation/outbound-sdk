// How a sentence for a person writes a count: `1 lead`, `3 leads`, never
// `1 lead(s)`. Insights, tools, cards and alerts all write counts with these.

/**
 * The word that goes with `amount`: `one` for exactly one, `many` otherwise.
 * Works for verbs too: `noun(count, "is", "are")`.
 */
export const noun = (amount: number, one: string, many = `${one}s`): string =>
  amount === 1 ? one : many;

/** `1 lead`, `3 leads`. Pass `many` when adding an `s` is wrong. */
export const plural = (amount: number, one: string, many = `${one}s`): string =>
  `${amount} ${noun(amount, one, many)}`;

/**
 * A person key as a person reads it: `email:jo@example.com` is the address,
 * `linkedin:jo-doe` the profile's address without `https://www.`.
 */
export const shownKey = (key: string): string => {
  if (key.startsWith("email:")) {
    return key.slice("email:".length);
  }

  return key.startsWith("linkedin:")
    ? `linkedin.com/in/${key.slice("linkedin:".length)}`
    : key;
};
