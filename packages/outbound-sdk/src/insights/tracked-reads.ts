// The listing and item reads an insight's context offers, and the notes they
// leave: a listing a cap stopped with more records left, and, in an insight
// that keeps a partial answer, the reads a request cap stopped part way.

import { mapConcurrent } from "../internal/concurrency.ts";
import { OutboundError } from "../internal/errors.ts";
import { plural } from "../internal/numbers.ts";
import type { ListAll, ResultMeta } from "../internal/outbound/api.ts";

/**
 * The cap a listing was read up to, for the note when it stops early:
 * `{ input: "max_campaigns", max: 25, what: "campaigns" }` gives "Stopped at
 * 25 campaigns (max_campaigns); more exist."
 */
export interface Cap {
  /** The cap as the caller set it, not the room left under it. */
  readonly max: number;
  /** What was counted, in the plural: `campaigns`, `leads of a campaign`. */
  readonly what: string;
  /** The input that raises the cap, or `null` for a cap no input sets. */
  readonly input: string | null;
}

// A custom insight written before `Cap` existed names its cap as free text,
// such as `50 campaigns`; that form is kept so its code still compiles.
const stopNote = (cap: Cap | string | undefined): string => {
  if (cap === undefined) {
    return "A listing was cut off at its cap; more records exist.";
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `cap` is a public argument that is either the old free-text form or a `Cap`
  return typeof cap === "string"
    ? `Stopped at ${cap}; more exist.`
    : capNote(cap);
};

/**
 * `cap.what` for a cap of one: its first plural word in the singular, so
 * `recent replies looked through` becomes `recent reply looked through`.
 */
const oneOf = (what: string): string =>
  what.replace(
    /\b(?<stem>\w+?)(?<end>ies|s)\b/u,
    (_match, stem: string, end: string) => (end === "ies" ? `${stem}y` : stem)
  );

/** The note for a listing that a cap stopped with more records left. */
export const capNote = (cap: Cap): string =>
  `Stopped at ${plural(cap.max, oneOf(cap.what), cap.what)} (${cap.input ?? "a fixed cap"}); more exist.`;

/** What a part of a listing is called in a note: `leads`, or `records` for a cap given as text. */
const recordsOf = (cap: Cap | string | undefined): string =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `cap` is a public argument that is either the old free-text form or a `Cap`
  cap === undefined || typeof cap === "string" ? "records" : cap.what;

/** What `context.all` is. */
export type All = <Item>(
  walk: ListAll<Item>,
  cap?: Cap | string
) => Promise<Item[]>;

/** What `context.each` is. */
export type Each = <Item, Result>(
  items: readonly Item[],
  read: (item: Item) => Promise<Result>,
  what: string
) => Promise<Result[]>;

/** What the reads record into the answer they are part of. */
export interface Recorder {
  /** What stopped the read when a request cap did and the insight keeps what it read. */
  readonly kept: (cause: unknown) => string | undefined;
  readonly partial: (reason: string) => void;
  readonly seen: (meta: ResultMeta | undefined) => void;
}

/**
 * `context.all` and `context.each` over one answer. A listing read while
 * items are being read is part of an item, so a cap stop there drops the
 * item instead of keeping a listing cut short: a campaign with its senders
 * cut off is left out, never counted with fewer senders.
 */
export interface TrackedReads {
  readonly all: All;
  readonly each: Each;
}

export const readsOf = ({ kept, partial, seen }: Recorder): TrackedReads => {
  let itemsInFlight = 0;

  const all = async <Item>(
    walk: ListAll<Item>,
    listed?: Cap | string
  ): Promise<Item[]> => {
    let items: Item[];

    try {
      items = await walk.toArray();
    } catch (error) {
      const reached = itemsInFlight > 0 ? undefined : kept(error);

      if (reached === undefined || !OutboundError.is(error)) {
        throw error;
      }

      // SAFETY: a walk's partial records are the records it lists.
      const read = [...(error.partial?.items ?? [])] as Item[];

      partial(
        `${reached} A listing of ${recordsOf(listed)} kept the ${read.length} it had read.`
      );

      return read;
    }

    seen(walk.meta);

    if (walk.truncated) {
      partial(stopNote(listed));
    }

    return items;
  };

  const each = async <Item, Result>(
    items: readonly Item[],
    read: (item: Item) => Promise<Result>,
    what: string
  ): Promise<Result[]> => {
    let reached: string | undefined;
    itemsInFlight += 1;

    try {
      const results = await mapConcurrent(items, async (item) => {
        try {
          return { value: await read(item) };
        } catch (error) {
          reached = kept(error);

          if (reached === undefined) {
            throw error;
          }

          return null;
        }
      });

      const done = results.flatMap((result) =>
        result === null ? [] : [result.value]
      );

      if (reached !== undefined) {
        partial(
          `${reached} Read ${done.length} of ${items.length} ${what}; the answer covers those.`
        );
      }

      return done;
    } finally {
      itemsInFlight -= 1;
    }
  };

  return { all, each };
};
