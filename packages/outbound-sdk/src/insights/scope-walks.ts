// Listings a campaign scope builds: a listing over records already read, a
// listing that starts once a check passes, and one listing made of a
// listing per campaign. Each behaves like any other `listAll` walk.

import type { Evidence } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { ListAll, ResultMeta } from "../internal/outbound/api.ts";

const RANK: Readonly<Record<Evidence, number>> = {
  derived: 2,
  exact: 0,
  sampled: 1,
};

/** The metas of several walks as one: requests added, notes kept once, the weakest evidence. */
const merged = (metas: readonly ResultMeta[]): ResultMeta | undefined => {
  const [first] = metas;

  if (first === undefined) {
    return undefined;
  }

  let { evidence } = first;

  for (const meta of metas) {
    if (RANK[meta.evidence] > RANK[evidence]) {
      ({ evidence } = meta);
    }
  }

  const sum = (of: (meta: ResultMeta) => number): number => {
    let total = 0;

    for (const meta of metas) {
      total += of(meta);
    }

    return total;
  };

  return {
    ...first,
    complete: metas.every((meta) => meta.complete),
    evidence,
    notes: [...new Set(metas.flatMap((meta) => meta.notes))],
    requests: sum((meta) => meta.requests),
    stale: metas.some((meta) => meta.stale),
    throttledMs: sum((meta) => meta.throttledMs),
  };
};

/** The same error, carrying the records read before it. */
const withItems = (error: OutboundError, items: readonly unknown[]) =>
  new OutboundError(error.code, error.message, {
    aborted: error.aborted,
    cause: error,
    limit: error.limit,
    partial: {
      cursor: undefined,
      items,
      requests: error.partial?.requests ?? 0,
    },
    permanent: error.permanent,
    provider: error.provider,
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    timedOut: error.timedOut,
  });

/**
 * A listing walked source after source, `max` records in all. The
 * sources come from `sources`, read once the walk starts; `walkOf` opens
 * each one's listing with the room left. `keyOf` drops a record an earlier
 * source already gave, such as a sender on two campaigns.
 */
export class FanWalk<Source, Item> implements ListAll<Item> {
  readonly #sources: () => Promise<readonly Source[]>;
  readonly #walkOf: (source: Source, room: number | undefined) => ListAll<Item>;
  readonly #max: number | undefined;
  readonly #keyOf: ((item: Item) => string) | undefined;
  readonly #keep: ((item: Item) => boolean) | undefined;
  readonly #metas: ResultMeta[] = [];
  #truncated = false;

  constructor(options: {
    readonly sources: () => Promise<readonly Source[]>;
    readonly walkOf: (
      source: Source,
      room: number | undefined
    ) => ListAll<Item>;
    readonly max?: number | undefined;
    readonly keyOf?: ((item: Item) => string) | undefined;
    /** Leaves out the records it returns `false` for, before they count toward `max`. */
    readonly keep?: ((item: Item) => boolean) | undefined;
  }) {
    this.#sources = options.sources;
    this.#walkOf = options.walkOf;
    this.#max = options.max;
    this.#keyOf = options.keyOf;
    this.#keep = options.keep;
  }

  readonly cursor: string | undefined = undefined;

  get meta(): ResultMeta | undefined {
    return merged(this.#metas);
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  /** Whether `item` is given: kept, and not one an earlier source gave. */
  #admits(item: Item, seen: Set<string>): boolean {
    if (this.#keep !== undefined && !this.#keep(item)) {
      return false;
    }

    const key = this.#keyOf?.(item);

    if (key === undefined) {
      return true;
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    const seen = new Set<string>();
    let yielded = 0;

    for (const source of await this.#sources()) {
      if (this.#max !== undefined && yielded >= this.#max) {
        // Whether more exist is not known without another read, so a full
        // walk counts as stopped at its cap.
        this.#truncated = true;

        return;
      }

      const walk = this.#walkOf(
        source,
        this.#max === undefined ? undefined : this.#max - yielded
      );

      try {
        // oxlint-disable-next-line no-await-in-loop -- one source after another, under one cap
        for await (const item of walk) {
          if (!this.#admits(item, seen)) {
            continue;
          }

          if (this.#max !== undefined && yielded >= this.#max) {
            this.#truncated = true;

            return;
          }

          yielded += 1;
          yield item;
        }
      } finally {
        if (walk.meta !== undefined) {
          this.#metas.push(walk.meta);
        }
      }

      this.#truncated ||= walk.truncated;
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

      throw withItems(error, [...items, ...(error.partial?.items ?? [])]);
    }

    return items;
  }
}

/** A listing of records already read, up to `max`. */
export const listOf = <Item>(
  read: () => Promise<readonly Item[]>,
  max?: number
): ListAll<Item> =>
  new FanWalk<readonly Item[], Item>({
    max,
    sources: async () => [await read()],
    walkOf: (items, room) => {
      const kept = room === undefined ? items : items.slice(0, room);
      let done = false;

      return {
        cursor: undefined,
        meta: undefined,
        async *[Symbol.asyncIterator]() {
          yield* kept;
          done = true;
        },
        toArray: () => Promise.resolve([...kept]),
        get truncated() {
          return done && kept.length < items.length;
        },
      };
    },
  });

/** The records of `walk` that `keep` returns `true` for. */
export const kept = <Item>(
  walk: ListAll<Item>,
  keep: (item: Item) => boolean
): ListAll<Item> =>
  new FanWalk<null, Item>({
    keep,
    sources: () => Promise.resolve([null]),
    walkOf: () => walk,
  });

/** A listing that opens only once `ready` resolves, as one walk. */
export const after = <Item>(
  ready: () => Promise<void>,
  open: () => ListAll<Item>
): ListAll<Item> =>
  new FanWalk<null, Item>({
    sources: async () => {
      await ready();

      return [null];
    },
    walkOf: () => open(),
  });
