// How a combined instance finds the adapter that owns a record or a page.

import type {
  Adapter,
  AdapterContext,
  Page,
  PageQuery,
} from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { isMemberUnavailable, toMemberFailure } from "../internal/failures.ts";
import type { MemberFailure } from "../internal/failures.ts";
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

interface Asked<Item> {
  readonly index: number;
  readonly member: Adapter;
  readonly answer: PromiseSettledResult<Page<Item>>;
}

/**
 * One page of a listing read from every member at the same time, for reads
 * that return few records, such as a lookup by exact address. Items keep the
 * members' order. The cursor holds each member still to finish, so the next
 * page asks only those, again side by side.
 *
 * A member that is unavailable (its key rejected, the tool down or rate
 * limiting) does not cost the caller what the others returned: it is listed in
 * `failures` and dropped from the cursor. The read still throws when no member
 * has answered, when a failure is a mistake in the call, and when the
 * caller's own abort signal, deadline or request budget stopped a member.
 */
export const pageTogether = async <Item>(
  members: readonly Adapter[],
  ctx: AdapterContext,
  query: PageQuery,
  read: (
    member: Adapter,
    memberCtx: AdapterContext,
    next: Json | undefined
  ) => Promise<Page<Item>>
): Promise<Page<Item>> => {
  const asked = waiting(query.next, members.length).flatMap((at) => {
    const member = members[at.index];

    return member === undefined ? [] : [{ ...at, member }];
  });

  const settled: Asked<Item>[] = await Promise.all(
    asked.map(async ({ index, member, next }) => {
      const [answer] = await Promise.allSettled([
        // Called inside the promise, so a read that throws at once is a
        // rejection like any other.
        (async () => await read(member, ctx.forAdapter(member), next))(),
      ]);

      return { answer, index, member };
    })
  );

  const items: Item[] = [];
  const unfinished: Json[] = [];
  const failures: MemberFailure[] = [];
  let firstError: unknown;

  for (const { answer, index, member } of settled) {
    if (answer.status === "fulfilled") {
      items.push(...answer.value.items);

      if (answer.value.next !== undefined) {
        unfinished.push({ member: index, next: answer.value.next });
      }
    } else if (isMemberUnavailable(answer.reason)) {
      firstError ??= answer.reason;
      failures.push(toMemberFailure(member, answer.reason));
    } else {
      // A mistake in the call, or a cap the caller set: the call fails whole.
      throw answer.reason;
    }
  }

  // On the first page, nobody answering means there is nothing to return. On
  // a later page the earlier answers stand, so the failures are reported.
  if (
    query.next === undefined &&
    failures.length > 0 &&
    failures.length === settled.length
  ) {
    throw firstError;
  }

  return {
    items,
    ...(failures.length === 0 ? undefined : { failures }),
    ...(unfinished.length === 0
      ? undefined
      : { next: { together: unfinished } }),
  };
};
