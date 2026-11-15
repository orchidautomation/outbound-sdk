// Plain arithmetic the insights share. No model, no fitting: counts, rates
// and two textbook tests, so every number can be checked by hand.

import { count, percentOf } from "../internal/numbers.ts";

const PLACES = 10_000;

/** Rounds to four decimal places. `null` stays `null`. */
export const round = (value: number | null): number | null =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * PLACES) / PLACES;

/** `part / whole`, or `null` when either is unknown or the whole is zero. */
export const rate = (
  part: number | null,
  whole: number | null
): number | null =>
  part === null || whole === null || whole <= 0 ? null : round(part / whole);

/** Adds the known values. `null` when none is known. */
export const total = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((value) => value !== null);

  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
};

export const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

/** The value below which `fraction` of the values fall, by linear interpolation. */
export const percentile = (
  values: readonly number[],
  fraction: number
): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const position = (sorted.length - 1) * Math.min(Math.max(fraction, 0), 1);
  const below = Math.floor(position);
  const low = sorted[below] ?? 0;
  const high = sorted[Math.ceil(position)] ?? low;

  return low + (high - low) * (position - below);
};

export const median = (values: readonly number[]): number | null =>
  percentile(values, 0.5);

/** The sample standard deviation. `null` with fewer than two values. */
export const deviation = (values: readonly number[]): number | null => {
  const center = mean(values);

  if (center === null || values.length < 2) {
    return null;
  }

  const squares = values.reduce((sum, value) => sum + (value - center) ** 2, 0);

  return Math.sqrt(squares / (values.length - 1));
};

/** How many standard deviations `value` sits from the mean of `history`. */
export const zScore = (
  value: number,
  history: readonly number[]
): number | null => {
  const center = mean(history);
  const spread = deviation(history);

  return center === null || spread === null || spread === 0
    ? null
    : (value - center) / spread;
};

const Z_95 = 1.96;

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * The Wilson score interval for a rate at 95% confidence. Unlike the raw
 * rate it stays honest on small samples: 2 replies from 10 sends gets a wide
 * interval, 200 from 1,000 a narrow one.
 */
export const wilson = (
  successes: number | null,
  trials: number | null
): Interval | null => {
  if (successes === null || trials === null || trials <= 0) {
    return null;
  }

  const share = Math.min(successes / trials, 1);
  const square = Z_95 ** 2;
  const denominator = 1 + square / trials;
  const center = share + square / (2 * trials);

  const margin =
    Z_95 *
    Math.sqrt((share * (1 - share)) / trials + square / (4 * trials ** 2));

  return {
    high: round(Math.min(1, (center + margin) / denominator)) ?? 1,
    low: round(Math.max(0, (center - margin) / denominator)) ?? 0,
  };
};

// Abramowitz and Stegun 7.1.26: the error function to about 1.5e-7.
const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);

  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;

  return sign * (1 - polynomial * Math.exp(-x * x));
};

export interface ProportionTest {
  /** Positive when the first rate is higher. */
  readonly z: number;
  /** Two-sided. Below 0.05 is the usual bar for "not chance". */
  readonly pValue: number;
  readonly significant: boolean;
}

export interface Sample {
  readonly successes: number | null;
  readonly trials: number | null;
}

/**
 * The two-proportion z-test: is the difference between two rates more than
 * chance would give? `null` when either side has no trials or both rates are
 * 0 or 1.
 */
export const compareRates = (
  first: Sample,
  second: Sample,
  alpha = 0.05
): ProportionTest | null => {
  if (
    first.successes === null ||
    first.trials === null ||
    second.successes === null ||
    second.trials === null ||
    first.trials <= 0 ||
    second.trials <= 0
  ) {
    return null;
  }

  const pooled =
    (first.successes + second.successes) / (first.trials + second.trials);

  const error = Math.sqrt(
    pooled * (1 - pooled) * (1 / first.trials + 1 / second.trials)
  );

  if (error === 0) {
    return null;
  }

  const z =
    (first.successes / first.trials - second.successes / second.trials) / error;

  const pValue = 1 - erf(Math.abs(z) / Math.SQRT2);

  return {
    pValue: round(pValue) ?? 0,
    significant: pValue < alpha,
    z: round(z) ?? 0,
  };
};

/** A rate for a sentence: `0.0525` as `5.3%`. `unknown` for `null`. */
export const percent = (value: number | null): string =>
  value === null ? "unknown" : percentOf(value);

/**
 * A count, average, length or score for a sentence, with at most one
 * decimal: `1.3333` as `1.3`, and `unknown` for `null`. The answer's own
 * fields keep full precision.
 */
export const spoken = (value: number | null): string =>
  value === null ? "unknown" : count(value);

/** A p-value for a sentence. One that rounds to 0 is written `p < 0.0001`, never `p = 0`. */
export const pText = (pValue: number): string =>
  pValue < 1 / PLACES ? `p < ${1 / PLACES}` : `p = ${pValue}`;

/** Counts how often each value occurs, in first-seen order. */
export const tally = <Value>(values: readonly Value[]): Map<Value, number> => {
  const counts = new Map<Value, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
};
