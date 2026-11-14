// Running independent reads side by side. The request engine still holds
// every request to the vendor's rate windows and per-credential cap; this only
// stops a caller from waiting on one read before starting the next.

/** How many independent reads a caller keeps in flight by default. */
export const DEFAULT_READ_CONCURRENCY = 4;

/**
 * Maps `items` through `read` with at most `limit` reads in flight, and
 * returns the results in the order of `items`. After a read fails no new read
 * starts, and the first failure is thrown once the reads in flight settle.
 */
export const mapConcurrent = async <Item, Result>(
  items: readonly Item[],
  read: (item: Item, index: number) => Promise<Result>,
  limit: number = DEFAULT_READ_CONCURRENCY
): Promise<Result[]> => {
  const results: Result[] = Array.from({ length: items.length });
  let next = 0;
  let failure: { readonly error: unknown } | undefined;

  const worker = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const index = next;
      next += 1;

      // SAFETY: index is below items.length, checked by the loop condition.
      const item = items[index] as Item;

      try {
        // oxlint-disable-next-line no-await-in-loop -- each worker takes one item at a time.
        results[index] = await read(item, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: workers }, worker));

  if (failure !== undefined) {
    throw failure.error;
  }

  return results;
};
