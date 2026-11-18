// A listing as a command prints it: its records, and whether `--limit`
// stopped the walk while more exist. People read that on stderr; stdout has
// it in the envelope's `meta.complete`, `meta.cursor` and `meta.notes`.
// With `--jsonl` each record is written as one line as its page arrives,
// so a walk of any size never sits in memory.

import type { Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import type { ListAll } from "../internal/outbound/api.ts";
import {
  countReplies,
  describeReplyCounts,
  repliesByPerson,
} from "../internal/reply-people.ts";
import { Answer } from "./envelope.ts";
import type { Coverage, Walked } from "./envelope.ts";

export interface ListingInput {
  readonly note: (text: string) => void;
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  /** Writes one record to stdout as a JSON line. */
  readonly emit?: ((record: Json) => void) | undefined;
}

/** The failure, carrying where the walk can resume and what it had read. */
const resumable = (
  error: OutboundError,
  walk: ListAll<unknown>,
  items: readonly unknown[]
): OutboundError =>
  new OutboundError(error.code, error.message, {
    aborted: error.aborted,
    cause: error,
    limit: error.limit,
    partial: {
      cursor: walk.cursor,
      items,
      requests: walk.meta?.requests ?? 0,
    },
    permanent: error.permanent,
    provider: error.provider,
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    timedOut: error.timedOut,
  });

/**
 * Every record of a walk, or with `stream` each one written as it arrives.
 * When `--limit` stopped it while more exist, a note on stderr says so and
 * where to resume. `one` and `many` name a record; `stop` says what
 * stopped the walk and what to do.
 */
const listed = async <Item>(
  walk: ListAll<Item>,
  input: ListingInput,
  names: { readonly one: string; readonly many?: string | undefined },
  options: { readonly stop?: string | undefined; readonly stream: boolean }
): Promise<{
  readonly items: Item[];
  readonly coverage: Coverage;
  readonly walked: Walked;
}> => {
  const emit = options.stream ? input.emit : undefined;
  const items: Item[] = [];
  let records = 0;
  // Records handed out from the page the cursor has not moved past yet:
  // resuming from the cursor reads them again.
  let pending = 0;
  let { cursor } = walk;

  try {
    for await (const item of walk) {
      if (walk.cursor !== cursor) {
        ({ cursor } = walk);
        pending = 0;
      }

      records += 1;
      pending += 1;

      if (emit === undefined) {
        items.push(item);
      } else {
        emit(toJson(item));
      }
    }
  } catch (error) {
    throw OutboundError.is(error) ? resumable(error, walk, items) : error;
  }

  const left = walk.meta?.notes ?? [];
  const streamed = emit !== undefined;

  if (!walk.truncated) {
    return {
      coverage: { complete: walk.meta?.complete ?? true, notes: [...left] },
      items,
      walked: { records, streamed },
    };
  }

  const repeats = walk.cursor === cursor ? pending : 0;

  const resume =
    walk.cursor === undefined
      ? "To resume, run it again without --cursor"
      : `To resume, pass --cursor ${walk.cursor}`;

  const notes = [
    `Stopped at ${plural(records, names.one, names.many)}${
      options.stop ?? "; more exist. Pass --limit to read more."
    }`,
    repeats === 0
      ? `${resume}.`
      : `${resume}; the first ${plural(repeats, "record")} it reads ${repeats === 1 ? "was" : "were"} printed already, so dedupe on ref.`,
  ];

  for (const note of notes) {
    input.note(note);
  }

  return {
    coverage: { complete: false, notes: [...left, ...notes] },
    items,
    walked: {
      cursor: walk.cursor,
      records,
      repeats,
      streamed,
      truncated: true,
    },
  };
};

const streams = (input: ListingInput): boolean => input.flags.jsonl === true;

export const listing = async <Item>(
  walk: ListAll<Item>,
  input: ListingInput,
  one: string,
  many?: string,
  stop?: string
): Promise<Answer> => {
  const { coverage, items, walked } = await listed(
    walk,
    input,
    { many, one },
    { stop, stream: streams(input) }
  );

  return new Answer(toJson(items), coverage, true, walked);
};

/** The answer with more notes on it. */
export const withNotes = (answer: Answer, notes: readonly string[]): Answer =>
  notes.length === 0
    ? answer
    : new Answer(
        answer.value,
        { ...answer.coverage, notes: [...notes, ...answer.coverage.notes] },
        answer.list,
        answer.walked,
        answer.text
      );

/** The most records a listing reads for a time window when no --limit is given. */
export const WINDOW_LIMIT = 2000;

/** What stops a `--since` walk that read up to WINDOW_LIMIT. */
export const WINDOW_STOP =
  ", the most a --since window reads without --limit; more exist. Pass --limit to read more, or a later --since.";

/**
 * Replies, one record per message or, `byPerson`, one row per person. A note
 * says how many people sent them, since each record is a message. A
 * `windowed` walk read up to WINDOW_LIMIT, and its stop note says so. Rows
 * per person need every reply first, so they are never streamed.
 */
export const listedReplies = async (
  walk: ListAll<Reply>,
  input: ListingInput,
  byPerson: boolean,
  windowed = false
): Promise<Answer> => {
  const { coverage, items, walked } = await listed(
    walk,
    input,
    { many: "replies", one: "reply" },
    {
      stop: windowed ? WINDOW_STOP : undefined,
      stream: streams(input) && !byPerson,
    }
  );

  if (walked.streamed === true) {
    return new Answer([], coverage, true, walked);
  }

  const counted = `${describeReplyCounts(countReplies(items))}.`;
  input.note(counted);

  return new Answer(
    toJson(byPerson ? repliesByPerson(items) : items),
    { ...coverage, notes: [...coverage.notes, counted] },
    true,
    walked
  );
};
