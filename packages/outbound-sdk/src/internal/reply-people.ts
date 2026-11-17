// A Reply is one received message, not one person: a lead who writes twice in
// a thread is two replies. These count the people and threads behind a list
// of replies, and group it into one row per person, so the CLI and the tools
// say the same thing about messages and people.

import type { Reply, ReplyCategory } from "./entities.ts";
import { plural } from "./plural.ts";

type Counted = Pick<Reply, "isAuto" | "leadRef" | "threadId">;

export interface ReplyCounts {
  /** Reply messages. */
  readonly messages: number;
  /** Distinct `leadRef`s. `null` when any reply has no `leadRef`. */
  readonly people: number | null;
  /** Distinct `threadId`s. `null` when any reply has no `threadId`. */
  readonly threads: number | null;
  /**
   * Replies flagged automatic (`isAuto: true`), counted among `messages`,
   * so a category count can leave them out. `null` when any reply's
   * `isAuto` is unknown.
   */
  readonly automatic: number | null;
}

const distinct = (values: readonly (string | null)[]): number | null =>
  values.includes(null) ? null : new Set(values).size;

const automaticOf = (
  replies: readonly Pick<Reply, "isAuto">[]
): number | null =>
  replies.some((reply) => reply.isAuto === null)
    ? null
    : replies.filter((reply) => reply.isAuto).length;

/** How many messages, people and threads a list of replies holds. */
export const countReplies = (replies: readonly Counted[]): ReplyCounts => ({
  automatic: automaticOf(replies),
  messages: replies.length,
  people: distinct(replies.map((reply) => reply.leadRef)),
  threads: distinct(replies.map((reply) => reply.threadId)),
});

/**
 * `40 messages from 21 people in 9 threads, 4 of them automatic`, leaving out
 * what is unknown.
 */
export const describeReplyCounts = (counts: ReplyCounts): string =>
  [
    plural(counts.messages, "message"),
    counts.people === null
      ? undefined
      : `from ${plural(counts.people, "person", "people")}`,
    counts.threads === null
      ? undefined
      : `in ${plural(counts.threads, "thread")}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ") +
  (counts.automatic === null || counts.automatic === 0
    ? ""
    : `, ${counts.automatic} of them automatic`);

/** One person's replies, from `repliesByPerson`. */
export interface ReplyPerson {
  /**
   * The lead who sent them. `null` for replies with no lead: those are
   * grouped by thread instead, one row per thread.
   */
  readonly leadRef: string | null;
  readonly messages: number;
  /** Of `messages`, those flagged automatic. `null` when any one's `isAuto` is unknown. */
  readonly automatic: number | null;
  /** The earliest and latest `sentAt`. `null` when no reply has one. */
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  /** Each category the replies carry, in the order first seen. */
  readonly categories: readonly ReplyCategory[];
  /** Each thread the replies are in, in the order first seen. */
  readonly threadIds: readonly string[];
}

type Grouped = Pick<
  Reply,
  "category" | "isAuto" | "leadRef" | "sentAt" | "threadId"
>;

const keyOf = (reply: Grouped, index: number): string => {
  if (reply.leadRef !== null) {
    return `lead:${reply.leadRef}`;
  }

  return reply.threadId === null
    ? `reply:${index}`
    : `thread:${reply.threadId}`;
};

const pushNew = <Value>(list: Value[], value: Value | null): void => {
  if (value !== null && !list.includes(value)) {
    list.push(value);
  }
};

// ISO times in one format compare as text.
const earliest = (a: string | null, b: string | null): string | null =>
  a === null || (b !== null && b < a) ? b : a;

const latest = (a: string | null, b: string | null): string | null =>
  a === null || (b !== null && b > a) ? b : a;

interface Row {
  readonly leadRef: string | null;
  readonly replies: Pick<Reply, "isAuto">[];
  firstAt: string | null;
  lastAt: string | null;
  readonly categories: ReplyCategory[];
  readonly threadIds: string[];
}

/**
 * One row per person, in the order each person first appears. A reply with
 * no `leadRef` is grouped by its thread, or stands alone without one.
 */
export const repliesByPerson = (replies: readonly Grouped[]): ReplyPerson[] => {
  const rows = new Map<string, Row>();

  for (const [index, reply] of replies.entries()) {
    const key = keyOf(reply, index);

    const row = rows.get(key) ?? {
      categories: [],
      firstAt: reply.sentAt,
      lastAt: reply.sentAt,
      leadRef: reply.leadRef,
      replies: [],
      threadIds: [],
    };

    row.replies.push(reply);
    row.firstAt = earliest(row.firstAt, reply.sentAt);
    row.lastAt = latest(row.lastAt, reply.sentAt);
    pushNew(row.categories, reply.category);
    pushNew(row.threadIds, reply.threadId);
    rows.set(key, row);
  }

  return [...rows.values()].map((row) => ({
    automatic: automaticOf(row.replies),
    categories: row.categories,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    leadRef: row.leadRef,
    messages: row.replies.length,
    threadIds: row.threadIds,
  }));
};
