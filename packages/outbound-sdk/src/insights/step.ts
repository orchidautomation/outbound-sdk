// One way to number sequence steps in every insight answer and sentence.

/**
 * Where a step sits in its sequence, counted both ways. Data compares
 * `stepIndex`; prose and anything shown to a person uses `stepNumber`.
 */
export interface StepPosition {
  /** Counted from 0, as the vendor and `Message.stepIndex` count: the first email is 0. */
  readonly stepIndex: number;
  /** Counted from 1, as a person counts: the first email is step 1. */
  readonly stepNumber: number;
  /** @deprecated Use `stepIndex` (the same value, counted from 0) or `stepNumber` (counted from 1). Removed in 0.15.0. */
  readonly step: number;
}

export const stepAt = (index: number): StepPosition => ({
  step: index,
  stepIndex: index,
  stepNumber: index + 1,
});

/** A step for a sentence, from 1: `step 2 (of 4)`, or `step 2` when the length is unknown. */
export const stepLabel = (index: number, of: number | null = null): string =>
  of === null || of < index + 1
    ? `step ${index + 1}`
    : `step ${index + 1} (of ${of})`;
