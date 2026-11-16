// A value the normalized record cannot hold costs that one field, not the
// whole read: the adapter maps it to `null` and says why in `meta.notes`.

/** Says what an adapter left out of a record, and why. */
export type Note = (text: string) => void;

export interface NegativeContext {
  readonly note: Note;
  /** The vendor's name as people know it, for example `Instantly`. */
  readonly vendor: string;
  /** What the value is, for example `Step 4's delay`. */
  readonly what: string;
  /** Written after the value in the note, for example `days`. */
  readonly unit?: string | undefined;
}

/**
 * A number the normalized record holds as 0 or more. A negative one is
 * `null`, with a note that names it.
 */
export const notNegative = (
  value: number | null,
  { note, unit, vendor, what }: NegativeContext
): number | null => {
  if (value === null || value >= 0) {
    return value;
  }

  note(
    `${what} is negative in ${vendor} (${value}${unit === undefined ? "" : ` ${unit}`}); left out.`
  );

  return null;
};
