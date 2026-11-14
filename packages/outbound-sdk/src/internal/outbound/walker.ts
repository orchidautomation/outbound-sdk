// listAll: walks every page under the rate budget and exposes a live cursor,
// so a sync that dies on page 40 restarts on page 40.

import type { CallState } from "../engine/request.ts";
import type { ListAll, PageResult, ResultMeta } from "./api.ts";

export interface WalkerOptions<Item> {
  readonly cursor: string | undefined;
  readonly max: number | undefined;
  /** Fetches one page. `state` is shared by every page of the walk. */
  readonly fetchPage: (
    cursor: string | undefined,
    state: CallState | undefined
  ) => Promise<{ readonly page: PageResult<Item>; readonly state: CallState }>;
  /** A stable key used to drop records a shifting page returned twice. */
  readonly keyOf: (item: Item) => string | undefined;
}

export class PageWalker<Item> implements ListAll<Item> {
  readonly #options: WalkerOptions<Item>;
  #cursor: string | undefined;
  #meta: ResultMeta | undefined;

  constructor(options: WalkerOptions<Item>) {
    this.#options = options;
    this.#cursor = options.cursor;
  }

  get cursor(): string | undefined {
    return this.#cursor;
  }

  get meta(): ResultMeta | undefined {
    return this.#meta;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    const { fetchPage, keyOf, max } = this.#options;
    const seen = new Set<string>();
    let state: CallState | undefined;
    let yielded = 0;

    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
      const fetched = await fetchPage(this.#cursor, state);
      ({ state } = fetched);
      this.#meta = fetched.page.meta;

      for (const item of fetched.page.items) {
        const key = keyOf(item);

        if (key === undefined || !seen.has(key)) {
          if (key !== undefined) {
            seen.add(key);
          }

          if (max !== undefined && yielded >= max) {
            return;
          }

          yielded += 1;
          yield item;
        }
      }

      // Advance only after the page was fully handed out, so resuming from
      // `cursor` never skips records.
      this.#cursor = fetched.page.cursor;

      if (this.#cursor === undefined) {
        return;
      }
    }
  }

  async toArray(): Promise<Item[]> {
    const items: Item[] = [];

    for await (const item of this) {
      items.push(item);
    }

    return items;
  }
}
