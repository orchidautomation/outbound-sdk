// Messages and replies of a combined instance, newest first across members.

import type {
  Adapter,
  AdapterContext,
  Page,
  PageQuery,
} from "../internal/adapter.ts";
import { count, field } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { ReadPage } from "./route.ts";

interface Dated {
  readonly sentAt: string | null;
}

/** Where a member stands: the cursor its current page was read from, and how many of that page's records are already given out. */
interface Spot {
  readonly index: number;
  readonly at: Json | undefined;
  readonly skip: number;
}

const spotsOf = (next: Json | undefined, size: number): readonly Spot[] => {
  const listed = field(next, "newest");

  if (!Array.isArray(listed)) {
    return Array.from({ length: size }, (_, index) => ({
      at: undefined,
      index,
      skip: 0,
    }));
  }

  return listed.flatMap((entry) => {
    const index = count(field(entry, "member"));

    return index === null || index >= size
      ? []
      : [
          {
            at: field(entry, "at") ?? undefined,
            index,
            skip: count(field(entry, "skip")) ?? 0,
          },
        ];
  });
};

// A record with no time sorts as the oldest.
const timeOf = (item: Dated): number =>
  item.sentAt === null ? 0 : Date.parse(item.sentAt);

/**
 * One page of messages or replies across every member, newest first. Each
 * member lists newest first, so a member with more pages has nothing newer
 * left than the last record of its page. A record is given out only once no
 * member with more pages can still hold a newer one; the rest wait, and the
 * cursor reads their page again and skips what was given out. A cap on the
 * walk therefore keeps exactly the newest records of all.
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

  const given = read.map(({ page, spot }) => {
    const left = page.items.slice(spot.skip);
    const ready = left.findIndex((item) => timeOf(item) < floor);

    return ready === -1 ? left.length : ready;
  });

  const items = read
    .flatMap(({ page, spot }, at) =>
      page.items.slice(spot.skip, spot.skip + (given[at] ?? 0))
    )
    .toSorted((a, b) => timeOf(b) - timeOf(a));

  const waiting = read.flatMap(({ page, spot }, at) => {
    const skip = spot.skip + (given[at] ?? 0);

    if (skip < page.items.length) {
      return [{ at: spot.at ?? null, member: spot.index, skip }];
    }

    return page.next === undefined
      ? []
      : [{ at: page.next, member: spot.index, skip: 0 }];
  });

  return waiting.length === 0
    ? { items }
    : { items, next: { newest: waiting } };
};
