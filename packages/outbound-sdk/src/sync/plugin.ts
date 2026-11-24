// outbound-sdk/sync: scheduled runs that fetch only what changed.
//
// It keeps one checkpoint per collection in a store you supply: a cursor, so
// a run that dies restarts on the page it was reading, and a high-water mark,
// so the next run asks only for newer records. Nothing is stored on our side.

import type { Entity } from "../internal/entities-account.ts";
import { OutboundError } from "../internal/errors.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { makeRef, parseRef } from "../internal/ref.ts";
import { findScope } from "../internal/scope/resolve.ts";
import type { ResolvedScope } from "../internal/scope/resolve.ts";
import { parseScope } from "../internal/scope/rule.ts";
import { inboxLeftOut } from "./inbox.ts";
import { runOnceIfCheaper } from "./once.ts";
import { runScoped } from "./scoped.ts";
import type { RunOne } from "./scoped.ts";
import { runSplit, splitsByCampaign } from "./split.ts";
import type {
  Checkpoint,
  CheckpointStore,
  SyncCollection,
  SyncExtension,
  SyncOptions,
  SyncPluginOptions,
  SyncResult,
} from "./types.ts";
import { dateNote, keyFor, startFor, tailNote, walkFor } from "./walk.ts";
import type { Runner } from "./walk.ts";

/** A checkpoint store in this process's memory, for tests and one-off scripts. */
export const memoryCheckpointStore = (): CheckpointStore => {
  const checkpoints = new Map<string, Checkpoint>();

  return {
    delete: (key) => {
      checkpoints.delete(key);

      return Promise.resolve();
    },
    get: (key) => Promise.resolve(checkpoints.get(key)),
    set: (key, checkpoint) => {
      checkpoints.set(key, checkpoint);

      return Promise.resolve();
    },
  };
};

const COLLECTIONS: readonly string[] = [
  "campaigns",
  "leads",
  "messages",
  "replies",
  "senders",
] satisfies readonly SyncCollection[];

/** Refuses a name that is not a collection. A caller without types can pass any string. */
const assertCollection = (outbound: OutboundApi, collection: string): void => {
  if (!COLLECTIONS.includes(collection)) {
    throw new OutboundError(
      "Invalid",
      `sync: "${collection}" is not a collection. Use one of ${COLLECTIONS.join(", ")}.`,
      { provider: outbound.provider }
    );
  }
};

/** Refuses `include` on a collection without bodies, before any request. */
const assertInclude = (
  outbound: OutboundApi,
  collection: SyncCollection,
  include: SyncOptions["include"]
): void => {
  if (
    include === undefined ||
    collection === "messages" ||
    collection === "replies"
  ) {
    return;
  }

  throw new OutboundError(
    "Invalid",
    `sync: include is for messages and replies, not ${collection}`,
    { provider: outbound.provider }
  );
};

/** A resolved scope this instance found, so its campaigns are this instance's. */
const assertResolved = (
  outbound: OutboundApi,
  resolved: ResolvedScope | undefined
): ResolvedScope => {
  const meta = resolved?.meta;

  const mine =
    Array.isArray(resolved?.campaigns) &&
    meta?.provider === outbound.provider &&
    meta.workspaceId === outbound.workspaceId;

  if (resolved === undefined || !mine) {
    throw new OutboundError(
      "Invalid",
      `sync: resolved must be what resolveScope returned for this instance (${outbound.provider}:${outbound.workspaceId}), not ${meta === undefined ? "something else" : `one of ${meta.provider}:${meta.workspaceId}`}`,
      { provider: outbound.provider }
    );
  }

  return resolved;
};

/**
 * The campaign a run covers, as a ref: a bare vendor id is qualified. None
 * for `campaigns`, which is listed whole whatever `campaignId` says.
 */
const campaignRefOf = (
  outbound: OutboundApi,
  collection: SyncCollection,
  campaignId: string | undefined
): string | undefined => {
  if (campaignId === undefined || collection === "campaigns") {
    return undefined;
  }

  return parseRef(campaignId) === null
    ? makeRef(outbound.provider, outbound.workspaceId, campaignId)
    : campaignId;
};

const runSync = async <Item extends Entity>(
  runner: Runner,
  collection: SyncCollection,
  options: SyncOptions<Item>
): Promise<SyncResult> => {
  const { now, outbound, overlapMs, store } = runner;
  assertCollection(outbound, collection);
  const key = keyFor(outbound, collection, options.campaignId);

  const campaignRef = campaignRefOf(outbound, collection, options.campaignId);

  const named = campaignRef === undefined ? {} : { campaignRef };
  const previous = (await store.get(key)) ?? {};
  const startedAt = previous.startedAt ?? new Date(now()).toISOString();

  const start = startFor(outbound, collection, previous, overlapMs);
  const walk = walkFor(outbound, collection, options, start.since);
  const iterator = walk.start(start.cursor);
  const tail = previous.tail === undefined ? {} : { tail: previous.tail };
  let page: Item[] = [];
  let pages = 0;
  let records = 0;
  let lastCursor = start.cursor;

  const flush = async (): Promise<void> => {
    await options.onPage(page, { campaignRef });
    records += page.length;
    pages += 1;
    page = [];
    lastCursor = iterator.cursor;
    // Saved after the page is handled, so a crash replays it and never skips it.
    await store.set(key, {
      ...named,
      ...tail,
      cursor: lastCursor,
      since: previous.since,
      startedAt,
    });
  };

  const inbox = inboxLeftOut(outbound, collection, campaignRef !== undefined);

  const result = (complete: boolean): SyncResult => {
    const requests = iterator.meta?.requests ?? 0;

    return {
      collection,
      complete,
      filter: walk.filter,
      inboxLeftOut: inbox.count,
      notes: [
        ...(start.fromTail
          ? [tailNote(outbound.provider, requests, records)]
          : dateNote(outbound.provider, collection, walk, requests, records)),
        ...inbox.notes,
      ],
      pages,
      records,
      requests,
      resumed: previous.cursor !== undefined,
      since: walk.since,
      throttledMs: iterator.meta?.throttledMs ?? 0,
    };
  };

  for await (const item of iterator) {
    // The walker moves its cursor once a page is fully handed out.
    if (iterator.cursor !== lastCursor && page.length > 0) {
      await flush();

      if (options.maxPages !== undefined && pages >= options.maxPages) {
        return result(false);
      }
    }

    // SAFETY: the caller named Item for this collection; the walker yields that collection's records.
    page.push(item as Item);
  }

  if (page.length > 0) {
    await flush();
  }

  // The run finished: the next one starts from when this one began, or on
  // a listing in creation order from where this walk ended.
  const finished: Checkpoint = { ...named, since: startedAt };
  const end = iterator.tail ?? previous.tail;

  await store.set(
    key,
    collection === "leads" &&
      outbound.capabilities["leads.createdOrder"] &&
      end !== undefined
      ? { ...finished, tail: end }
      : finished
  );

  return result(true);
};

/**
 * Syncs a resolved scope: one walk split here where the vendor filters the
 * collection by campaign only after reading it all, or where every campaign
 * finished a run and one walk is cheaper, else campaign by campaign.
 */
const runFound = async <Item extends Entity>(
  runner: Runner,
  collection: SyncCollection,
  options: SyncOptions<Item>,
  found: ResolvedScope,
  requests: number
): Promise<SyncResult> => {
  if (splitsByCampaign(runner.outbound, collection)) {
    return await runSplit(runner, collection, options, found, requests);
  }

  const runOne: RunOne = (each, perCampaign) =>
    runSync(runner, each, perCampaign);

  return (
    (await runOnceIfCheaper(
      runner,
      runOne,
      collection,
      options,
      found,
      requests
    )) ??
    (await runScoped(
      runOne,
      runner.outbound,
      collection,
      options,
      found,
      requests
    ))
  );
};

/** Incremental, resumable syncs with checkpoints in a store you supply. */
export const sync = (
  options: SyncPluginOptions
): OutboundPlugin<SyncExtension> => ({
  extend: (outbound) => {
    const runner: Runner = {
      now: options.now ?? (() => Date.now()),
      outbound,
      overlapMs: (options.overlapMinutes ?? 5) * 60_000,
      store: options.checkpoints,
    };

    return {
      sync: {
        reset: async (collection, campaignId) => {
          assertCollection(outbound, collection);
          await options.checkpoints.delete(
            keyFor(outbound, collection, campaignId)
          );
        },
        run: async (collection, runOptions) => {
          assertCollection(outbound, collection);
          assertInclude(outbound, collection, runOptions.include);
          const scope = parseScope(runOptions, "sync");
          const { resolved } = runOptions;

          if (scope === null && resolved === undefined) {
            return await runSync(runner, collection, runOptions);
          }

          const given = [
            runOptions.campaignId === undefined ? [] : ["campaignId"],
            scope === null ? [] : ["a campaign scope"],
            resolved === undefined ? [] : ["resolved"],
          ].flat();

          if (given.length > 1) {
            throw new OutboundError(
              "Invalid",
              `sync: give campaignId or a campaign scope (campaign_ids, tag, campaign_name, statuses) or resolved, one only, not ${given.join(" and ")}`,
              { provider: outbound.provider }
            );
          }

          const found =
            resolved === undefined && scope !== null
              ? await findScope(outbound, scope, "sync")
              : assertResolved(outbound, resolved);

          return await runFound(
            runner,
            collection,
            runOptions,
            found,
            found === resolved ? 0 : found.meta.requests
          );
        },
      },
    };
  },
  name: "sync",
});
