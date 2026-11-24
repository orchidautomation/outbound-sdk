// A sync run under a campaign scope: the scope's campaigns are found first,
// as every insight finds them, then each campaign is synced with its own
// checkpoint, so nothing of another campaign is read.

import type { Entity } from "../internal/entities-account.ts";
import { OutboundError } from "../internal/errors.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { ResolvedScope } from "../internal/scope/resolve.ts";
import { inboxLeftOut } from "./inbox.ts";
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

/**
 * A campaign's run, or `null` when the tool lists the campaign but answers
 * `NotFound` to reading it, such as a HeyReach draft it cannot open.
 */
const skipMissing = async <Item extends Entity>(
  runOne: RunOne,
  collection: SyncCollection,
  options: SyncOptions<Item>
): Promise<SyncResult | null> => {
  try {
    return await runOne(collection, options);
  } catch (error) {
    if (OutboundError.is(error) && error.code === "NotFound") {
      return null;
    }

    throw error;
  }
};

/** The campaigns collection under a scope: the scope's campaigns, as one page. */
const scopeListing = async <Item extends Entity>(
  resolved: ResolvedScope,
  options: SyncOptions<Item>,
  requests: number
): Promise<SyncResult> => {
  const { campaigns, meta } = resolved;

  if (campaigns.length > 0) {
    // SAFETY: the caller named Item for the campaigns collection, whose records these are.
    await options.onPage(campaigns as readonly Item[], {
      campaignRef: undefined,
    });
  }

  return {
    collection: "campaigns",
    complete: true,
    filter: "none",
    inboxLeftOut: 0,
    notes: meta.notes,
    pages: campaigns.length > 0 ? 1 : 0,
    records: campaigns.length,
    requests,
    resumed: false,
    scope: {
      campaigns: campaigns.map((campaign) => ({
        campaignRef: campaign.ref,
        complete: true,
        name: campaign.name,
        pages: 1,
        records: 1,
      })),
      inboxLeftOut: 0,
      meta,
      skipped: [],
    },
    since: undefined,
    throttledMs: 0,
  };
};

/**
 * Syncs each campaign of a resolved scope. `requests` is what finding the
 * campaigns cost this run: `0` for a scope resolved before it.
 */
export const runScoped = async <Item extends Entity>(
  runOne: RunOne,
  outbound: Pick<OutboundApi, "capabilities" | "provider">,
  collection: SyncCollection,
  options: SyncOptions<Item>,
  resolved: ResolvedScope,
  requests: number
): Promise<SyncResult> => {
  const { meta } = resolved;

  if (collection === "campaigns") {
    return await scopeListing(resolved, options, requests);
  }

  // A sender of several campaigns is handed out once per run.
  const handed = new Set<string>();

  const onPage: SyncOptions<Item>["onPage"] = (items, page) => {
    if (collection !== "senders") {
      return options.onPage(items, page);
    }

    const fresh = items.filter((item) => !handed.has(item.ref));

    for (const item of fresh) {
      handed.add(item.ref);
    }

    return fresh.length > 0 ? options.onPage(fresh, page) : undefined;
  };

  const results: SyncResult[] = [];
  const campaigns: SyncCampaignResult[] = [];
  const skipped: string[] = [];
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
    const result = await skipMissing(runOne, collection, {
      campaignId: campaign.ref,
      limit: options.limit,
      maxPages: pagesLeft,
      onPage,
    });

    if (result === null) {
      skipped.push(campaign.ref);
      campaigns.push({
        campaignRef: campaign.ref,
        complete: false,
        name: campaign.name,
        pages: 0,
        records: 0,
        skipped: { reason: "cannot-open" },
      });
      continue;
    }

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

  const inbox = inboxLeftOut(outbound, collection, true);

  return {
    collection,
    complete: campaigns.every(
      (campaign) => campaign.complete || campaign.skipped !== undefined
    ),
    filter: weakest(results),
    inboxLeftOut: inbox.count,
    notes: [
      ...new Set([
        ...meta.notes,
        ...results.flatMap((result) => result.notes),
        ...(skipped.length === 0
          ? []
          : [
              `${outbound.provider} lists ${skipped.length === 1 ? "a campaign" : `${skipped.length} campaigns`} it cannot open, so ${skipped.length === 1 ? "it was" : "they were"} skipped: ${skipped.join(", ")}.`,
            ]),
        ...inbox.notes,
      ]),
    ],
    pages: sum((result) => result.pages),
    records: sum((result) => result.records),
    requests: requests + sum((result) => result.requests),
    resumed: results.some((result) => result.resumed),
    scope: { campaigns, inboxLeftOut: inbox.count, meta, skipped },
    since: earliest(results),
    throttledMs: sum((result) => result.throttledMs),
  };
};
