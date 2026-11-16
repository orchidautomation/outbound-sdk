// A listing as a command prints it: its records, and whether `--limit`
// stopped the walk while more exist. People read that on stderr; stdout has
// it in the envelope's `meta.complete` and `meta.notes`.

import type { Reply } from "../internal/entities.ts";
import { toJson } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import type { ListAll } from "../internal/outbound/api.ts";
import {
  countReplies,
  describeReplyCounts,
  repliesByPerson,
} from "../internal/reply-people.ts";
import { Answer } from "./envelope.ts";
import type { Coverage } from "./envelope.ts";

/**
 * Every record of a walk. When `--limit` stopped it while more exist, a note
 * on stderr says so, and `coverage` carries it for the envelope. `one` and
 * `many` name a record.
 */
const listed = async <Item>(
  walk: ListAll<Item>,
  input: { readonly note: (text: string) => void },
  one: string,
  many?: string
): Promise<{ readonly items: Item[]; readonly coverage: Coverage }> => {
  const items = await walk.toArray();
  const left = walk.meta?.notes ?? [];

  if (!walk.truncated) {
    return {
      coverage: { complete: walk.meta?.complete ?? true, notes: [...left] },
      items,
    };
  }

  const note = `Stopped at ${plural(items.length, one, many)}; more exist. Pass --limit to read more.`;
  input.note(note);

  return { coverage: { complete: false, notes: [...left, note] }, items };
};

export const listing = async <Item>(
  walk: ListAll<Item>,
  input: { readonly note: (text: string) => void },
  one: string,
  many?: string
): Promise<Answer> => {
  const { coverage, items } = await listed(walk, input, one, many);

  return new Answer(toJson(items), coverage, true);
};

/**
 * Replies, one record per message or, `byPerson`, one row per person. A note
 * says how many people sent them, since each record is a message.
 */
export const listedReplies = async (
  walk: ListAll<Reply>,
  input: { readonly note: (text: string) => void },
  byPerson: boolean
): Promise<Answer> => {
  const { coverage, items } = await listed(walk, input, "reply", "replies");
  const counted = `${describeReplyCounts(countReplies(items))}.`;
  input.note(counted);

  return new Answer(
    toJson(byPerson ? repliesByPerson(items) : items),
    { ...coverage, notes: [...coverage.notes, counted] },
    true
  );
};
