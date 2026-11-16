// "Did you mean": the known words closest to a mistyped one.

/**
 * Edits between two words: an insertion, a deletion, a substitution or a
 * swap of two neighbouring letters each count one, so `campaing` is one edit
 * from `campaign`.
 */
export const distance = (from: string, to: string): number => {
  const rows = Array.from({ length: from.length + 1 }, (_row, row) =>
    Array.from({ length: to.length + 1 }, (_cell, column) =>
      row === 0 || column === 0 ? row + column : 0
    )
  );

  const at = (row: number, column: number): number =>
    rows[row]?.[column] ?? Infinity;

  for (let row = 1; row <= from.length; row += 1) {
    for (let column = 1; column <= to.length; column += 1) {
      const cost = from[row - 1] === to[column - 1] ? 0 : 1;

      const swapped =
        row > 1 &&
        column > 1 &&
        from[row - 1] === to[column - 2] &&
        from[row - 2] === to[column - 1];

      const best = Math.min(
        at(row - 1, column) + 1,
        at(row, column - 1) + 1,
        at(row - 1, column - 1) + cost,
        swapped ? at(row - 2, column - 2) + 1 : Infinity
      );

      const line = rows[row];

      if (line !== undefined) {
        line[column] = best;
      }
    }
  }

  return at(from.length, to.length);
};

/** The furthest a known word may be from the typed one to be suggested. */
const MAX_EDITS = 2;

/** How many suggestions to make at most. */
const SHOWN = 3;

/** The known words at most two edits away, closest first. */
export const closest = (typed: string, known: Iterable<string>): string[] =>
  [...new Set(known)]
    .flatMap((word) => {
      const edits = distance(typed, word);

      return edits <= MAX_EDITS ? [{ edits, word }] : [];
    })
    .toSorted((one, other) => one.edits - other.edits)
    .slice(0, SHOWN)
    .map(({ word }) => word);

/** ` Did you mean "a" or "b"?`, or nothing when no known word is close. */
export const didYouMean = (
  typed: string,
  known: Iterable<string>,
  prefix = ""
): string => {
  const near = closest(typed, known).map((word) => `"${prefix}${word}"`);

  return near.length === 0 ? "" : ` Did you mean ${near.join(" or ")}?`;
};
