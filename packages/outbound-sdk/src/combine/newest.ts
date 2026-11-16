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

/**
 * Where a member stands: the cursor its current page was read from, and the
 * last record of that page already given out, if any.
 */
interface Spot {
  readonly index: number;
  readonly at: Json | undefined;
  readonly after:
    | { readonly ref: string; readonly sentAt: string | null }
    | undefined;
}

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
    const ref = text(field(entry, "afterRef"));

    return index === null || index >= size
      ? []
      : [
          {
            after:
              ref === null
                ? undefined
                : { ref, sentAt: text(field(entry, "afterSentAt")) },
            at: field(entry, "at") ?? undefined,
            index,
          },
        ];
  });
};

// A record with no time sorts as the oldest.
const timeOf = (item: Pick<Dated, "sentAt">): number =>
  item.sentAt === null ? 0 : Date.parse(item.sentAt);

/**
 * Where a re-read page resumes: after the last record given out. A page the
 * vendor changed in between, by a new or a deleted record, is resumed by
 * time when that record is gone. A page lists newest first and is given out
 * up to its first record older than the floor, so every record at that
 * record's time was given out with it, and every record still waiting is
 * strictly older.
 */
const resumeAt = (items: readonly Dated[], spot: Spot): number => {
  const { after } = spot;

  if (after === undefined) {
    return 0;
  }

  const given = items.findIndex((item) => item.ref === after.ref);

  if (given !== -1) {
    return given + 1;
  }

  const older = items.findIndex((item) => timeOf(item) < timeOf(after));

  return older === -1 ? items.length : older;
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
              left: page.items.slice(resumeAt(page.items, spot)),
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
    const last = out.at(-1);

    if (out.length < left.length) {
      return [
        {
          afterRef: last?.ref ?? spot.after?.ref ?? null,
          afterSentAt:
            last === undefined ? (spot.after?.sentAt ?? null) : last.sentAt,
          at: spot.at ?? null,
          member: spot.index,
        },
      ];
    }

    return page.next === undefined
      ? []
      : [
          {
            afterRef: null,
            afterSentAt: null,
            at: page.next,
            member: spot.index,
          },
        ];
  });

  return waiting.length === 0
    ? { items }
    : { items, next: { newest: waiting } };
};
