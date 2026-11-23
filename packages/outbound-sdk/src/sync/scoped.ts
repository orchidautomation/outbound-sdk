// A sync run under a campaign scope: the scope's campaigns are found first,
// as every insight finds them, then each campaign is synced with its own
// checkpoint, so nothing of another campaign is read.

import type { Entity } from "../internal/entities-account.ts";
import { findScope } from "../internal/scope/resolve.ts";
import type { ResolvedScope } from "../internal/scope/resolve.ts";
import type { CampaignScope } from "../internal/scope/rule.ts";
import type {
  SyncCampaignResult,
  SyncCollection,
  SyncFilter,
  SyncOptions,
  SyncResult,
} from "./types.ts";

/** Runs the unscoped sync for one campaign. */
export type RunOne = <Item extends Entity>(
  collection: SyncCollection,
  options: SyncOptions<Item>
) => Promise<SyncResult>;

const FILTER_RANK: Readonly<Record<SyncFilter, number>> = {
  client: 2,
  none: 0,
  server: 1,
};

const earliest = (results: readonly SyncResult[]): string | undefined =>
  results
    .flatMap((result) => (result.since === undefined ? [] : [result.since]))
    .toSorted()[0];

const weakest = (results: readonly SyncResult[]): SyncFilter => {
  let filter: SyncFilter = "none";

  for (const result of results) {
    if (FILTER_RANK[result.filter] > FILTER_RANK[filter]) {
      ({ filter } = result);
    }
  }

  return filter;
};

const sumOf = (
  results: readonly SyncResult[],
  of: (result: SyncResult) => number
): number => {
  let total = 0;

  for (const result of results) {
    total += of(result);
  }

  return total;
};

/** The campaigns collection under a scope: the scope's campaigns, as one page. */
const scopeListing = async <Item extends Entity>(
  resolved: ResolvedScope,
  options: SyncOptions<Item>
): Promise<SyncResult> => {
  const { campaigns, meta } = resolved;

  if (campaigns.length > 0) {
    // SAFETY: the caller named Item for the campaigns collection, whose records these are.
    await options.onPage(campaigns as readonly Item[]);
  }

  return {
    collection: "campaigns",
    complete: true,
    filter: "none",
    notes: meta.notes,
    pages: campaigns.length > 0 ? 1 : 0,
    records: campaigns.length,
    requests: meta.requests,
    resumed: false,
    scope: {
      campaigns: campaigns.map((campaign) => ({
        campaignRef: campaign.ref,
        complete: true,
        name: campaign.name,
        pages: 1,
        records: 1,
      })),
      meta,
    },
    since: undefined,
    throttledMs: 0,
  };
};

export const runScoped = async <Item extends Entity>(
  runOne: RunOne,
  outbound: Parameters<typeof findScope>[0],
  collection: SyncCollection,
  options: SyncOptions<Item>,
  scope: CampaignScope
): Promise<SyncResult> => {
  const resolved = await findScope(outbound, scope, "sync");
  const { meta } = resolved;

  if (collection === "campaigns") {
    return await scopeListing(resolved, options);
  }

  // A sender of several campaigns is handed out once per run.
  const handed = new Set<string>();

  const onPage = (items: readonly Item[]): void | Promise<void> => {
    if (collection !== "senders") {
      return options.onPage(items);
    }

    const fresh = items.filter((item) => !handed.has(item.ref));

    for (const item of fresh) {
      handed.add(item.ref);
    }

    return fresh.length > 0 ? options.onPage(fresh) : undefined;
  };

  const results: SyncResult[] = [];
  const campaigns: SyncCampaignResult[] = [];
  let pagesLeft = options.maxPages;

  for (const campaign of resolved.campaigns) {
    const stopped =
      (pagesLeft !== undefined && pagesLeft <= 0) ||
      results.some((result) => !result.complete);

    if (stopped) {
      campaigns.push({
        campaignRef: campaign.ref,
        complete: false,
        name: campaign.name,
        pages: 0,
        records: 0,
      });
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop -- one campaign after another, each with its own checkpoint
    const result = await runOne(collection, {
      campaignId: campaign.ref,
      limit: options.limit,
      maxPages: pagesLeft,
      onPage,
    });

    results.push(result);
    pagesLeft = pagesLeft === undefined ? undefined : pagesLeft - result.pages;
    campaigns.push({
      campaignRef: campaign.ref,
      complete: result.complete,
      name: campaign.name,
      pages: result.pages,
      records: result.records,
    });
  }

  const sum = (of: (result: SyncResult) => number): number =>
    sumOf(results, of);

  return {
    collection,
    complete: campaigns.every((campaign) => campaign.complete),
    filter: weakest(results),
    notes: [
      ...new Set([...meta.notes, ...results.flatMap((result) => result.notes)]),
    ],
    pages: sum((result) => result.pages),
    records: sum((result) => result.records),
    requests: meta.requests + sum((result) => result.requests),
    resumed: results.some((result) => result.resumed),
    scope: { campaigns, meta },
    since: earliest(results),
    throttledMs: sum((result) => result.throttledMs),
  };
};
