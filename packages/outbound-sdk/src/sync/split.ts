// A scoped sync of a collection the vendor cannot filter by campaign, such
// as Smartlead's messages, whose activity feed takes no campaign: the
// collection is read once and split here by campaign, instead of read whole
// once per campaign. Each campaign keeps its own checkpoint, keyed by its
// ref, as in any scoped run.

import type { Entity } from "../internal/entities-account.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { ResolvedScope } from "../internal/scope/resolve.ts";
import { inboxLeftOut } from "./inbox.ts";
import type {
  Checkpoint,
  SyncCampaignResult,
  SyncOptions,
  SyncResult,
} from "./types.ts";
import { dateNote, keyFor, overlapped, walkFor } from "./walk.ts";
import type { Runner, Walk } from "./walk.ts";

type Split = "messages" | "replies";

/**
 * Whether a scoped run of this collection reads it once and splits it here:
 * the vendor filters it by campaign only after reading all of it. Not on a
 * combined instance, whose members may filter on their side.
 */
export const splitsByCampaign = (
  outbound: Pick<OutboundApi, "capabilities" | "provider">,
  collection: string
): collection is Split =>
  outbound.provider !== "combined" &&
  (collection === "messages" || collection === "replies") &&
  outbound.capabilities[`${collection}.byCampaign`] === "client";

/** Where one walk for every campaign starts: only where they all stopped together. */
const startOf = (
  previous: readonly (Checkpoint | undefined)[],
  now: string
): { readonly cursor: string | undefined; readonly startedAt: string } => {
  const [first] = previous;

  const together =
    first?.cursor !== undefined &&
    previous.every(
      (each) =>
        each?.cursor === first.cursor && each?.startedAt === first.startedAt
    );

  return together
    ? { cursor: first.cursor, startedAt: first.startedAt ?? now }
    : { cursor: undefined, startedAt: now };
};

/** The earliest lower bound of the campaigns, none when any has not finished a run. */
const earliestSince = (
  previous: readonly (Checkpoint | undefined)[]
): string | undefined => {
  const sinces = previous.map((each) => each?.since);

  return sinces.includes(undefined)
    ? undefined
    : sinces.filter((since) => since !== undefined).toSorted()[0];
};

interface Tally {
  pages: number;
  records: number;
}

interface Walked {
  readonly complete: boolean;
  readonly pages: number;
  readonly requests: number;
  readonly throttledMs: number;
}

/** What one walk for every campaign of a scope works from. */
interface Shared {
  readonly campaigns: ResolvedScope["campaigns"];
  /** Each campaign's checkpoint key, and its checkpoint before this run. */
  readonly keys: readonly string[];
  readonly previous: readonly (Checkpoint | undefined)[];
  readonly from: {
    readonly cursor: string | undefined;
    readonly startedAt: string;
  };
  readonly tally: ReadonlyMap<string, Tally>;
}

/** One walk of the collection, each page handed to its campaigns in the scope's order. */
const walkOnce = async <Item extends Entity>(
  runner: Runner,
  options: SyncOptions<Item>,
  walk: Walk,
  shared: Shared
): Promise<Walked> => {
  const { campaigns, from, keys, previous, tally } = shared;
  const iterator = walk.start(from.cursor);
  let page: Item[] = [];
  let pages = 0;
  let lastCursor = from.cursor;

  const save = async (each: (at: number) => Checkpoint): Promise<void> => {
    await Promise.all(keys.map((key, at) => runner.store.set(key, each(at))));
  };

  const flush = async (): Promise<void> => {
    for (const campaign of campaigns) {
      const mine = page.filter(
        // SAFETY: messages and replies carry campaignRef, a ref or null.
        (item) =>
          (item as { campaignRef?: unknown }).campaignRef === campaign.ref
      );

      const counts = tally.get(campaign.ref);

      if (mine.length > 0 && counts !== undefined) {
        // oxlint-disable-next-line no-await-in-loop -- onPage is awaited in order, one campaign after another
        await options.onPage(mine, { campaignRef: campaign.ref });
        counts.pages += 1;
        counts.records += mine.length;
      }
    }

    pages += 1;
    page = [];
    lastCursor = iterator.cursor;
    // Saved after the page is handled, so a crash replays it and never skips it.
    await save((at) => ({
      campaignRef: campaigns[at]?.ref,
      cursor: lastCursor,
      since: previous[at]?.since,
      startedAt: from.startedAt,
    }));
  };

  const done = (complete: boolean): Walked => ({
    complete,
    pages,
    requests: iterator.meta?.requests ?? 0,
    throttledMs: iterator.meta?.throttledMs ?? 0,
  });

  for await (const item of iterator) {
    if (iterator.cursor !== lastCursor && page.length > 0) {
      await flush();

      if (options.maxPages !== undefined && pages >= options.maxPages) {
        return done(false);
      }
    }

    // SAFETY: the caller named Item for this collection; the walker yields that collection's records.
    page.push(item as Item);
  }

  if (page.length > 0) {
    await flush();
  }

  // The walk finished: every campaign's next run starts from when it began.
  await save((at) => ({
    campaignRef: campaigns[at]?.ref,
    since: from.startedAt,
  }));

  return done(true);
};

/** Syncs the scope's campaigns from one walk of the whole collection. */
export const runSplit = async <Item extends Entity>(
  runner: Runner,
  collection: Split,
  options: SyncOptions<Item>,
  resolved: ResolvedScope,
  found: number
): Promise<SyncResult> => {
  const { now, outbound, overlapMs, store } = runner;
  const { campaigns, meta } = resolved;

  const keys = campaigns.map((each) => keyFor(outbound, collection, each.ref));
  const previous = await Promise.all(keys.map((key) => store.get(key)));

  const from = startOf(previous, new Date(now()).toISOString());

  const walk = walkFor(
    outbound,
    collection,
    { limit: options.limit },
    overlapped(earliestSince(previous), overlapMs)
  );

  const tally = new Map(
    campaigns.map((each) => [each.ref, { pages: 0, records: 0 }])
  );

  const walked =
    campaigns.length === 0
      ? { complete: true, pages: 0, requests: 0, throttledMs: 0 }
      : await walkOnce(runner, options, walk, {
          campaigns,
          from,
          keys,
          previous,
          tally,
        });

  const inbox = inboxLeftOut(outbound, collection, true);

  const each: SyncCampaignResult[] = campaigns.map((campaign) => ({
    campaignRef: campaign.ref,
    complete: walked.complete,
    name: campaign.name,
    pages: tally.get(campaign.ref)?.pages ?? 0,
    records: tally.get(campaign.ref)?.records ?? 0,
  }));

  const records = each.reduce((sum, campaign) => sum + campaign.records, 0);

  return {
    collection,
    complete: walked.complete,
    filter: walk.filter,
    inboxLeftOut: inbox.count,
    notes: [
      ...new Set([
        ...meta.notes,
        `${outbound.provider} cannot filter ${collection} by campaign, so this run read them once (${walked.requests} requests) and kept the ${campaigns.length} campaigns' records here, instead of reading them all once per campaign.`,
        ...dateNote(
          outbound.provider,
          collection,
          walk,
          walked.requests,
          records
        ),
        ...inbox.notes,
      ]),
    ],
    pages: walked.pages,
    records,
    requests: found + walked.requests,
    resumed: from.cursor !== undefined,
    scope: { campaigns: each, inboxLeftOut: inbox.count, meta, skipped: [] },
    since: walk.since,
    throttledMs: walked.throttledMs,
  };
};
