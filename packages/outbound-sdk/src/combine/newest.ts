// Messages and replies of a combined instance, newest first across members.

import type {
  Adapter,
  AdapterContext,
  Page,
  PageQuery,
} from "../internal/adapter.ts";
import { count, field, text } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { ReadPage } from "./route.ts";

interface Dated {
  readonly ref: string;
  readonly sentAt: string | null;
}

/** The last record of a page already given out. */
interface Given {
  readonly ref: string;
  readonly sentAt: string | null;
  /** Every record already given out with the same time, `ref` among them. */
  readonly tied: readonly string[];
}

/** Where a member stands: the cursor its current page was read from, and what of that page is given out. */
interface Spot {
  readonly index: number;
  readonly at: Json | undefined;
  readonly after: Given | undefined;
}

const givenOf = (entry: Json): Given | undefined => {
  const ref = text(field(entry, "afterRef"));
  const tied = field(entry, "afterTied");

  return ref === null
    ? undefined
    : {
        ref,
        sentAt: text(field(entry, "afterSentAt")),
        tied: Array.isArray(tied)
          ? tied.flatMap((each) => text(each) ?? [])
          : [ref],
      };
};

const spotsOf = (next: Json | undefined, size: number): readonly Spot[] => {
  const listed = field(next, "newest");

  if (!Array.isArray(listed)) {
    return Array.from({ length: size }, (_, index) => ({
      after: undefined,
      at: undefined,
      index,
    }));
  }

  return listed.flatMap((entry) => {
    const index = count(field(entry, "member"));

    return index === null || index >= size
      ? []
      : [{ after: givenOf(entry), at: field(entry, "at") ?? undefined, index }];
  });
};

// A record with no time sorts as the oldest.
const timeOf = (item: Pick<Dated, "sentAt">): number =>
  item.sentAt === null ? 0 : Date.parse(item.sentAt);

/**
 * Where a re-read page resumes: after the last record given out. When the
 * vendor deleted that record in between, the page resumes by time: at the
 * first record older than it, or as old but not given out yet.
 */
const resumeAt = (
  items: readonly Dated[],
  after: Given | undefined
): number => {
  if (after === undefined) {
    return 0;
  }

  const given = items.findIndex((item) => item.ref === after.ref);

  if (given !== -1) {
    return given + 1;
  }

  const time = timeOf(after);

  const waiting = items.findIndex(
    (item) =>
      timeOf(item) < time ||
      (timeOf(item) === time && !after.tied.includes(item.ref))
  );

  return waiting === -1 ? items.length : waiting;
};

/** The last record given out on this page so far, with every record given out at its time. */
const lastGiven = (
  before: Given | undefined,
  out: readonly Dated[]
): Given | undefined => {
  const last = out.at(-1);

  if (last === undefined) {
    return before;
  }

  const time = timeOf(last);

  return {
    ref: last.ref,
    sentAt: last.sentAt,
    tied: [
      ...(before !== undefined && timeOf(before) === time ? before.tied : []),
      ...out.flatMap((item) => (timeOf(item) === time ? [item.ref] : [])),
    ],
  };
};

/**
 * One page of messages or replies across every member, newest first. Each
 * member lists newest first, so a member with more pages has nothing newer
 * left than the last record of its page. A record is given out only once no
 * member with more pages can still hold a newer one; the rest wait, and the
 * cursor reads their page again and resumes after the last record given out.
 * A cap on the walk therefore keeps exactly the newest records of all.
 */
export const pageNewestFirst = async <Item extends Dated>(
  members: readonly Adapter[],
  ctx: AdapterContext,
  query: PageQuery,
  readPage: ReadPage<Item>
): Promise<Page<Item>> => {
  const read = await Promise.all(
    spotsOf(query.next, members.length).flatMap((spot) => {
      const member = members[spot.index];

      return member === undefined
        ? []
        : [
            readPage(member, ctx.forAdapter(member), spot.at).then((page) => ({
              left: page.items.slice(resumeAt(page.items, spot.after)),
              page,
              spot,
            })),
          ];
    })
  );

  // The newest any member with more pages may still hold.
  const floor = Math.max(
    -Infinity,
    ...read.flatMap(({ page }) => {
      if (page.next === undefined) {
        return [];
      }

      const last = page.items.at(-1);

      return [last === undefined ? Infinity : timeOf(last)];
    })
  );

  const given = read.map(({ left }) => {
    const waits = left.findIndex((item) => timeOf(item) < floor);

    return left.slice(0, waits === -1 ? left.length : waits);
  });

  const items = given.flat().toSorted((a, b) => timeOf(b) - timeOf(a));

  const waiting = read.flatMap(({ left, page, spot }, at) => {
    const out = given[at] ?? [];

    if (out.length < left.length) {
      const after = lastGiven(spot.after, out);

      return [
        {
          afterRef: after?.ref ?? null,
          afterSentAt: after?.sentAt ?? null,
          afterTied: [...(after?.tied ?? [])],
          at: spot.at ?? null,
          member: spot.index,
        },
      ];
    }

    return page.next === undefined
      ? []
      : [{ at: page.next, member: spot.index }];
  });

  return waiting.length === 0
    ? { items }
    : { items, next: { newest: waiting } };
};
