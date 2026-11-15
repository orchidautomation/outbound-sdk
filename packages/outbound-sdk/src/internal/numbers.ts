// How a sentence for a person writes a number: a count with thousands
// grouped, `2,000 leads`, and a rate as `5%` or `5.3%`. Insights, tools,
// cards, alerts and the CLI all write numbers with these, so a number reads
// the same in an answer's sentence and on its card. Kept apart from
// `plural.ts`, which the core uses, so the core does not carry the formatter.

import { noun } from "./plural.ts";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A count for a sentence, with thousands separators and at most one decimal: `2,000`, `1.5`. */
export const count = (amount: number): string => NUMBER.format(amount);

/** A rate in percent points with at most one decimal and no sign: `0.0525` as `5.3`, `0.05` as `5`. */
export const points = (rate: number): string =>
  NUMBER.format(Math.round(rate * 1000) / 10);

/** A rate as a percent: `0.0525` as `5.3%`, `0.05` as `5%`. */
export const percentOf = (rate: number): string => `${points(rate)}%`;

/** `1 lead`, `2,000 leads`. Pass `many` when adding an `s` is wrong. */
export const plural = (amount: number, one: string, many = `${one}s`): string =>
  `${count(amount)} ${noun(amount, one, many)}`;
