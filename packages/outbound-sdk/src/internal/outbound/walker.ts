// listAll: walks every page under the rate budget and exposes a live cursor,
// so a sync that dies on page 40 restarts on page 40.

import type { CallState } from "../engine/request.ts";
import { OutboundError } from "../errors.ts";
import type { ListAll, PageResult, ResultMeta } from "./api.ts";

export interface WalkerOptions<Item> {
  readonly cursor: string | undefined;
  readonly max: number | undefined;
  /** Stop after this many pages, without fetching the next. */
  readonly pages?: number | undefined;
  /** Starts the call's accounting, when the first page is asked for. */
  readonly begin: () => CallState;
  /** Fetches one page. `state` is shared by every page of the walk. */
  readonly fetchPage: (
    cursor: string | undefined,
    state: CallState
  ) => Promise<{ readonly page: PageResult<Item> }>;
  /** A stable key used to drop records a shifting page returned twice. */
  readonly keyOf: (item: Item) => string | undefined;
}

export class PageWalker<Item> implements ListAll<Item> {
  readonly #options: WalkerOptions<Item>;
  #cursor: string | undefined;
  #tail: string | undefined;
  #meta: ResultMeta | undefined;
  #truncated = false;
  #state: CallState | undefined;

  constructor(options: WalkerOptions<Item>) {
    this.#options = options;
    this.#cursor = options.cursor;
  }

  get cursor(): string | undefined {
    return this.#cursor;
  }

  get tail(): string | undefined {
    return this.#tail;
  }

  get meta(): ResultMeta | undefined {
    return this.#meta;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    const { begin, fetchPage, keyOf, max, pages } = this.#options;
    const seen = new Set<string>();
    const state = begin();
    this.#state = state;
    let yielded = 0;
    let fetchedPages = 0;

    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
      const fetched = await fetchPage(this.#cursor, state);
      fetchedPages += 1;
      // One page served stale makes the walk stale, whichever page came last.
      this.#meta =
        this.#meta?.stale === true
          ? { ...fetched.page.meta, stale: true }
          : fetched.page.meta;

      for (const item of fetched.page.items) {
        const key = keyOf(item);

        if (key === undefined || !seen.has(key)) {
          if (key !== undefined) {
            seen.add(key);
          }

          if (max !== undefined && yielded >= max) {
            // Another record exists past the cap.
            this.#truncated = true;

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

      this.#tail = this.#cursor;

      const capped =
        (max !== undefined && yielded >= max) ||
        (pages !== undefined && fetchedPages >= pages);

      if (capped) {
        // The cap fell on the end of a page and the vendor has more pages.
        this.#truncated = true;

        return;
      }
    }
  }

  async toArray(): Promise<Item[]> {
    const items: Item[] = [];

    try {
      for await (const item of this) {
        items.push(item);
      }
    } catch (error) {
      if (!OutboundError.is(error)) {
        throw error;
      }

      // Keep what was fetched. A walk fails only between pages, after the
      // cursor moved past every record collected, so resuming from it
      // neither skips nor repeats one.
      throw new OutboundError(error.code, error.message, {
        aborted: error.aborted,
        cause: error,
        limit: error.limit,
        permanent: error.permanent,
        partial: {
          cursor: this.#cursor,
          items,
          requests: this.#state?.requests ?? 0,
        },
        provider: error.provider,
        retryAfterMs: error.retryAfterMs,
        status: error.status,
        timedOut: error.timedOut,
      });
    }

    return items;
  }
}
