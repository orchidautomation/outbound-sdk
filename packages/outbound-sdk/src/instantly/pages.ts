// Paging helpers shared by the Instantly readers. Every list has the same
// shape: `limit` and `starting_after` in, `items` and `next_starting_after` out.

import type { AdapterContext, PageQuery } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { isString } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { QueryValue } from "../internal/url.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import { isCustomInterest, NO_LABELS, toLabels } from "./map-lead.ts";
import type { Labels } from "./map-lead.ts";
import { listEnvelope } from "./map.ts";
import type { ListEnvelope } from "./map.ts";

type Filters = Readonly<Record<string, QueryValue>>;

export const pageSize = (limit: number | undefined): number =>
  Math.min(limit ?? PAGE_SIZE, PAGE_SIZE);

export const after = (next: Json | undefined): string | undefined =>
  isString(next) ? next : undefined;

/** One page of a GET list. */
export const listPage = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  path: string,
  query: PageQuery,
  filters: Filters = {}
): Promise<ListEnvelope> =>
  listEnvelope(
    await client.get(ctx, path, {
      query: {
        ...filters,
        limit: pageSize(query.limit),
        starting_after: after(query.next),
      },
    }),
    client.identity.provider,
    path
  );

interface Lookup {
  readonly path: string;
  readonly filters: Filters;
  /** How many pages may still be read. */
  readonly pages: number;
}

/**
 * Every record of a small lookup that belongs to one page of results, such
 * as the tag assignments of 100 campaigns. It stops at `pages` requests and
 * refuses to return a cut-off answer.
 */
export const readLookup = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  lookup: Lookup,
  next?: string
): Promise<JsonObject[]> => {
  const envelope = await listPage(
    client,
    ctx,
    lookup.path,
    { limit: PAGE_SIZE, next },
    lookup.filters
  );

  // Instantly returns a next marker even on the last page (seen live: a page
  // of 11 tags came with one, and the page after it was empty). A page that
  // is not full is the last one, which saves a request per lookup.
  if (envelope.next === undefined || envelope.items.length < PAGE_SIZE) {
    return envelope.items;
  }

  if (lookup.pages <= 1) {
    throw new OutboundError(
      "Provider",
      `Instantly has more ${lookup.path} records for this page than the adapter reads`,
      { provider: client.identity.provider }
    );
  }

  const rest = await readLookup(
    client,
    ctx,
    { ...lookup, pages: lookup.pages - 1 },
    envelope.next
  );

  return [...envelope.items, ...rest];
};

/**
 * The workspace's custom lead labels, read only when one of `statuses` is
 * not a built-in interest status. One page: the first 100 labels.
 */
export const readLabels = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  statuses: readonly (Json | undefined)[]
): Promise<Labels> => {
  if (!statuses.some((status) => isCustomInterest(status))) {
    return NO_LABELS;
  }

  const envelope = await listPage(client, ctx, "/lead-labels", {});

  return toLabels(envelope.items);
};
