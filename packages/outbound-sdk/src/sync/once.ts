// A scoped sync of replies or messages where the vendor filters by campaign,
// such as Instantly's emails: once every campaign has finished a run, one
// read of the workspace from the earliest lower bound usually costs fewer
// requests than one read per campaign, each of which costs a request even
// when nothing is new. The walk is held to one page fewer than the campaigns;
// a walk that needs more stops, and the run goes on campaign by campaign.

import type { Entity } from "../internal/entities-account.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { ResolvedScope } from "../internal/scope/resolve.ts";
import type { RunOne } from "./scoped.ts";
import { runScoped } from "./scoped.ts";
import { runSplit, startOf } from "./split.ts";
import type { Split } from "./split.ts";
import type {
  Checkpoint,
  SyncCampaignResult,
  SyncCollection,
  SyncOptions,
  SyncResult,
} from "./types.ts";
import { keyFor } from "./walk.ts";
import type { Runner } from "./walk.ts";

/**
 * Whether one walk may serve the scope: the vendor filters the collection
 * by campaign and by date, and every campaign finished a run, or they all
 * stopped together in such a walk. Not on a combined instance.
 */
const readsOnce = (
  outbound: Pick<OutboundApi, "capabilities" | "provider">,
  collection: SyncCollection,
  previous: readonly (Checkpoint | undefined)[]
): collection is Split => {
  const eligible =
    outbound.provider !== "combined" &&
    (collection === "messages" || collection === "replies") &&
    outbound.capabilities[`${collection}.byCampaign`] === "server" &&
    outbound.capabilities[`${collection}.since`] === "server" &&
    previous.length > 1;

  if (!eligible) {
    return false;
  }

  const finished = previous.every(
    (each) => each?.since !== undefined && each.cursor === undefined
  );

  return finished || startOf(previous, "").cursor !== undefined;
};

/** The walk's records added to the per-campaign run that followed it. */
const merged = (
  once: SyncResult,
  each: SyncResult,
  budget: number
): SyncResult => {
  const walked = new Map(
    (once.scope?.campaigns ?? []).map((campaign) => [
      campaign.campaignRef,
      campaign,
    ])
  );

  const campaigns: SyncCampaignResult[] = (each.scope?.campaigns ?? []).map(
    (campaign) => ({
      ...campaign,
      pages: campaign.pages + (walked.get(campaign.campaignRef)?.pages ?? 0),
      records:
        campaign.records + (walked.get(campaign.campaignRef)?.records ?? 0),
    })
  );

  return {
    ...each,
    notes: [
      `The workspace's ${each.collection} since the earliest campaign's last run did not fit in ${budget} pages, one fewer than the campaigns, so this run stopped that read (${once.requests} requests, ${once.records} records) and went on campaign by campaign. Records it already handed out can come again.`,
      ...each.notes,
    ],
    pages: once.pages + each.pages,
    records: once.records + each.records,
    requests: once.requests + each.requests,
    resumed: once.resumed || each.resumed,
    scope: each.scope === undefined ? undefined : { ...each.scope, campaigns },
    throttledMs: once.throttledMs + each.throttledMs,
  };
};

/**
 * Syncs a resolved scope with one walk where that is cheaper, else campaign
 * by campaign. `null` when one walk does not apply.
 */
export const runOnceIfCheaper = async <Item extends Entity>(
  runner: Runner,
  runOne: RunOne,
  collection: SyncCollection,
  options: SyncOptions<Item>,
  resolved: ResolvedScope,
  found: number
): Promise<SyncResult | null> => {
  const { outbound, store } = runner;
  const { campaigns } = resolved;
  const keys = campaigns.map((each) => keyFor(outbound, collection, each.ref));
  const previous = await Promise.all(keys.map((key) => store.get(key)));

  if (!readsOnce(outbound, collection, previous)) {
    return null;
  }

  const budget = campaigns.length - 1;
  const capped = options.maxPages !== undefined && options.maxPages <= budget;

  const once = await runSplit(
    runner,
    collection,
    { ...options, maxPages: capped ? options.maxPages : budget },
    resolved,
    found,
    "cheaper"
  );

  if (once.complete || capped) {
    return once;
  }

  // Reading on would cost more than a read per campaign: drop the walk's
  // cursor, so each campaign goes on from its own lower bound.
  await Promise.all(
    keys.map((key, at) =>
      store.set(key, {
        campaignRef: campaigns[at]?.ref,
        since: previous[at]?.since,
      })
    )
  );

  const each = await runScoped(
    runOne,
    outbound,
    collection,
    {
      ...options,
      maxPages:
        options.maxPages === undefined
          ? undefined
          : options.maxPages - once.pages,
    },
    resolved,
    0
  );

  return merged(once, each, budget);
};
