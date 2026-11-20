// A Reply is one received message, not one person: a lead who writes twice in
// a thread is two replies. These count the people and threads behind a list
// of replies, and group it into one row per person, so the CLI and the tools
// say the same thing about messages and people.

import type { Lead, Reply, ReplyCategory } from "./entities.ts";
import { plural } from "./plural.ts";
import { profileSlug } from "./url.ts";

type Counted = Pick<Reply, "isAuto" | "leadEmail" | "leadRef" | "threadId">;

/**
 * The person behind a reply: its address where the vendor names one, since
 * one person in two campaigns is two leads (OUT-149), else its lead.
 */
const personOf = (reply: Pick<Reply, "leadEmail" | "leadRef">): string | null =>
  reply.leadEmail ?? reply.leadRef;

export interface ReplyCounts {
  /** Reply messages. */
  readonly messages: number;
  /**
   * Distinct people, by `leadEmail` or else `leadRef`. `null` when any
   * reply has neither.
   */
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
  people: distinct(replies.map(personOf)),
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
   * The tool and workspace of the lead in `leadRef`, or of the first reply
   * where there is no lead. A person whose replies span two tools is grouped
   * by address into one row, which names the first one's.
   */
  readonly provider: string;
  readonly workspaceId: string;
  /**
   * The lead who sent them. `null` for replies with no lead: those are
   * grouped by thread instead, one row per thread. A person in two
   * campaigns is two leads; this is the first one's.
   */
  readonly leadRef: string | null;
  /** Their address, where the vendor names one. */
  readonly leadEmail: string | null;
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
  | "category"
  | "isAuto"
  | "leadEmail"
  | "leadRef"
  | "provider"
  | "sentAt"
  | "threadId"
  | "workspaceId"
>;

const keyOf = (reply: Grouped, index: number): string => {
  const person = personOf(reply);

  if (person !== null) {
    return `lead:${person}`;
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
  readonly provider: string;
  readonly workspaceId: string;
  readonly leadRef: string | null;
  readonly leadEmail: string | null;
  readonly replies: Pick<Reply, "isAuto">[];
  firstAt: string | null;
  lastAt: string | null;
  readonly categories: ReplyCategory[];
  readonly threadIds: string[];
}

/**
 * One row per person, by `leadEmail` or else `leadRef`, in the order each
 * person first appears. A reply with neither is grouped by its thread, or
 * stands alone without one.
 */
export const repliesByPerson = (replies: readonly Grouped[]): ReplyPerson[] => {
  const rows = new Map<string, Row>();

  for (const [index, reply] of replies.entries()) {
    const key = keyOf(reply, index);

    const row = rows.get(key) ?? {
      categories: [],
      firstAt: reply.sentAt,
      lastAt: reply.sentAt,
      leadEmail: reply.leadEmail ?? null,
      leadRef: reply.leadRef,
      provider: reply.provider,
      replies: [],
      threadIds: [],
      workspaceId: reply.workspaceId,
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
    leadEmail: row.leadEmail,
    leadRef: row.leadRef,
    messages: row.replies.length,
    provider: row.provider,
    threadIds: row.threadIds,
    workspaceId: row.workspaceId,
  }));
};

/**
 * The replies a walk gives from its first `people` people, by the same key
 * as `repliesByPerson`, and whether a reply from another person came after
 * them. The walk stops at that reply, so a listed person's older replies
 * past it are not read.
 */
export const repliesOfFirstPeople = async <Item extends Grouped>(
  walk: AsyncIterable<Item>,
  people: number
): Promise<{ readonly replies: Item[]; readonly morePeople: boolean }> => {
  const replies: Item[] = [];
  const seen = new Set<string>();

  for await (const reply of walk) {
    const key = keyOf(reply, replies.length);

    if (!seen.has(key)) {
      if (seen.size >= people) {
        return { morePeople: true, replies };
      }

      seen.add(key);
    }

    replies.push(reply);
  }

  return { morePeople: false, replies };
};

/** One person's rows from `repliesByPerson`, joined across tools. */
export interface LinkedPerson extends ReplyPerson {
  /** Their LinkedIn profile, from a lead where one carries it. */
  readonly linkedinUrl: string | null;
  /** Every lead joined into this person, in the order first seen. */
  readonly leads: readonly string[];
  /** Every tool their replies came from, as `provider:workspaceId`, in the order first seen. */
  readonly tools: readonly string[];
}

type Identifiers = Pick<Lead, "email" | "linkedinUrl">;

// An address is compared lowercased and a profile by its slug, so a token
// that stands in for either (under redact) is compared as written.
const keysOf = (email: string | null, linkedin: string | null): string[] => [
  ...(email === null ? [] : [`email:${email.trim().toLowerCase()}`]),
  ...(linkedin === null
    ? []
    : [`linkedin:${profileSlug(linkedin) ?? linkedin.trim().toLowerCase()}`]),
];

const merged = (
  first: LinkedPerson,
  rest: readonly LinkedPerson[]
): LinkedPerson => {
  const group = [first, ...rest];

  const all = <Value>(pick: (person: LinkedPerson) => readonly Value[]) => [
    ...new Set(group.flatMap(pick)),
  ];

  let { firstAt, lastAt } = first;
  let automatic: number | null = 0;
  let messages = 0;

  for (const person of group) {
    firstAt = earliest(firstAt, person.firstAt);
    lastAt = latest(lastAt, person.lastAt);
    automatic =
      automatic === null || person.automatic === null
        ? null
        : automatic + person.automatic;
    messages += person.messages;
  }

  return {
    ...first,
    automatic,
    categories: all((person) => person.categories),
    firstAt,
    lastAt,
    leadEmail:
      group.find((person) => person.leadEmail !== null)?.leadEmail ?? null,
    leads: all((person) => person.leads),
    linkedinUrl:
      group.find((person) => person.linkedinUrl !== null)?.linkedinUrl ?? null,
    messages,
    threadIds: all((person) => person.threadIds),
    tools: all((person) => person.tools),
  };
};

/**
 * The rows of `repliesByPerson` with each lead's address and profile filled
 * from `leads` (by lead ref), and rows that share either joined into one
 * person, in the order each person first appears. This is how an email
 * replier and a LinkedIn replier become one person: a lead in one tool
 * carries the profile the other tool knows them by.
 */
export const linkPeople = (
  people: readonly ReplyPerson[],
  leads: ReadonlyMap<string, Identifiers>
): LinkedPerson[] => {
  const rows: LinkedPerson[] = people.map((person) => {
    const lead =
      person.leadRef === null ? undefined : leads.get(person.leadRef);

    return {
      ...person,
      leadEmail: person.leadEmail ?? lead?.email ?? null,
      leads: person.leadRef === null ? [] : [person.leadRef],
      linkedinUrl: lead?.linkedinUrl ?? null,
      tools: [`${person.provider}:${person.workspaceId}`],
    };
  });

  // Each row joins the group of the first earlier row it shares a key with,
  // and groups it bridges are joined too.
  const parent = rows.map((_, index) => index);

  const root = (index: number): number => {
    let at = index;

    while (parent[at] !== at) {
      at = parent[at] ?? at;
    }

    return at;
  };

  const owner = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    for (const key of keysOf(row.leadEmail, row.linkedinUrl)) {
      const earlier = owner.get(key);

      if (earlier === undefined) {
        owner.set(key, index);
      } else {
        const [left, right] = [root(earlier), root(index)];
        parent[Math.max(left, right)] = Math.min(left, right);
      }
    }
  }

  // A group's root is its first row, so each group is in first-seen order.
  const groups = new Map<
    number,
    { readonly first: LinkedPerson; readonly rest: LinkedPerson[] }
  >();

  for (const [index, row] of rows.entries()) {
    const at = root(index);
    const group = groups.get(at);

    if (group === undefined) {
      groups.set(at, { first: row, rest: [] });
    } else {
      group.rest.push(row);
    }
  }

  return [...groups.values()].map(({ first, rest }) => merged(first, rest));
};
