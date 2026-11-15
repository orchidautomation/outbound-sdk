// How a sentence for a person writes a count or a rate: `1 lead`, `2,000
// leads`, never `1 lead(s)`, and `5%` or `5.3%`. Insights, tools, cards and
// alerts all write numbers with these, so a number reads the same in an
// answer's sentence and on its card.

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A count for a sentence, with thousands separators and at most one decimal: `2,000`, `1.5`. */
export const count = (amount: number): string => NUMBER.format(amount);

/** A rate in percent points with at most one decimal and no sign: `0.0525` as `5.3`, `0.05` as `5`. */
export const points = (rate: number): string =>
  NUMBER.format(Math.round(rate * 1000) / 10);

/** A rate as a percent: `0.0525` as `5.3%`, `0.05` as `5%`. */
export const percentOf = (rate: number): string => `${points(rate)}%`;

/**
 * The word that goes with `amount`: `one` for exactly one, `many` otherwise.
 * Works for verbs too: `noun(count, "is", "are")`.
 */
export const noun = (amount: number, one: string, many = `${one}s`): string =>
  amount === 1 ? one : many;

/** `1 lead`, `3 leads`. Pass `many` when adding an `s` is wrong. */
export const plural = (amount: number, one: string, many = `${one}s`): string =>
  `${count(amount)} ${noun(amount, one, many)}`;

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
