// How a combined instance finds the adapter that owns a record or a page.

import type {
  Adapter,
  AdapterContext,
  Page,
  PageQuery,
} from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, field } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { parseRef } from "../internal/ref.ts";

export const COMBINED = "combined";

export interface Routed {
  readonly member: Adapter;
  readonly ctx: AdapterContext;
  /** The vendor's own id, without the provider and workspace. */
  readonly id: string;
}

/** Finds the member a ref belongs to. A bare vendor id cannot be routed. */
export const routeRef = (
  members: readonly Adapter[],
  ctx: AdapterContext,
  id: string,
  what: string
): Routed => {
  const parts = parseRef(id);

  const member =
    parts === null
      ? undefined
      : members.find(
          (candidate) =>
            candidate.name === parts.provider &&
            candidate.workspaceId === parts.workspaceId
        );

  if (parts === null || member === undefined) {
    throw new OutboundError(
      "Invalid",
      `${what} "${id}" must be a ref (provider:workspace:id) of an adapter on this combined instance`,
      { provider: COMBINED }
    );
  }

  return { ctx: ctx.forAdapter(member), id: parts.sourceId, member };
};

interface Position {
  readonly index: number;
  readonly next: Json | undefined;
}

const position = (next: Json | undefined): Position => ({
  index: count(field(next, "member")) ?? 0,
  next: field(next, "next") ?? undefined,
});

/**
 * One page of a listing that spans every member: the first member is read to
 * its end, then the second, and so on. The cursor records which member the
 * walk is in, so it resumes exactly.
 */
export const pageAcross = async <Item>(
  members: readonly Adapter[],
  ctx: AdapterContext,
  query: PageQuery,
  read: (
    member: Adapter,
    memberCtx: AdapterContext,
    next: Json | undefined
  ) => Promise<Page<Item>>
): Promise<Page<Item>> => {
  const at = position(query.next);
  const member = members[at.index];

  if (member === undefined) {
    return { items: [] };
  }

  const page = await read(member, ctx.forAdapter(member), at.next);

  if (page.next !== undefined) {
    return { items: page.items, next: { member: at.index, next: page.next } };
  }

  return at.index + 1 < members.length
    ? { items: page.items, next: { member: at.index + 1 } }
    : { items: page.items };
};

const waiting = (next: Json | undefined, size: number): readonly Position[] => {
  const listed = field(next, "together");

  if (!Array.isArray(listed)) {
    return Array.from({ length: size }, (_, index) => ({
      index,
      next: undefined,
    }));
  }

  return listed.flatMap((entry) => {
    const index = count(field(entry, "member"));

    return index === null || index >= size
      ? []
      : [{ index, next: field(entry, "next") ?? undefined }];
  });
};

/** How the pages of several members, in the members' order, become one page. */
export type Merge<Item> = (pages: readonly (readonly Item[])[]) => Item[];

/** One member's items after another's, in the members' order. */
const inOrder = <Item>(pages: readonly (readonly Item[])[]): Item[] =>
  pages.flat();

/**
 * The members' items taken in turn, one from each, so a cap on the walk
 * (`max_campaigns`, `--limit`) leaves every member its share instead of
 * filling up on the first one.
 */
export const inTurn = <Item>(pages: readonly (readonly Item[])[]): Item[] => {
  const longest = Math.max(0, ...pages.map((items) => items.length));

  return Array.from({ length: longest }, (_, at) =>
    pages.flatMap((items) => items.slice(at, at + 1))
  ).flat();
};

const timeOf = (sentAt: string | null): number =>
  sentAt === null ? 0 : Date.parse(sentAt);

/**
 * The members' items newest first by `sentAt`, so a cap on the walk keeps
 * the newest across every member; an item with no time goes last. Each
 * member lists newest first, so a cap no bigger than a member's page keeps
 * exactly the newest of all.
 */
export const newestFirst = <Item extends { readonly sentAt: string | null }>(
  pages: readonly (readonly Item[])[]
): Item[] =>
  pages.flat().toSorted((a, b) => timeOf(b.sentAt) - timeOf(a.sentAt));

/**
 * One page of a listing read from every member at the same time. `merge`
 * says how their items become one page; by default they keep the members'
 * order, as a lookup by exact address wants. The cursor holds each member
 * still to finish, so the next page asks only those, again side by side.
 */
export const pageTogether = async <Item>(
  members: readonly Adapter[],
  ctx: AdapterContext,
  query: PageQuery,
  read: (
    member: Adapter,
    memberCtx: AdapterContext,
    next: Json | undefined
  ) => Promise<Page<Item>>,
  merge: Merge<Item> = inOrder
): Promise<Page<Item>> => {
  const pages = await Promise.all(
    waiting(query.next, members.length).flatMap((at) => {
      const member = members[at.index];

      return member === undefined
        ? []
        : [
            read(member, ctx.forAdapter(member), at.next).then((page) => ({
              index: at.index,
              page,
            })),
          ];
    })
  );

  const unfinished = pages.flatMap(({ index, page }) =>
    page.next === undefined ? [] : [{ member: index, next: page.next }]
  );

  const items = merge(pages.map(({ page }) => page.items));

  return unfinished.length === 0
    ? { items }
    : { items, next: { together: unfinished } };
};
