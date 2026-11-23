// outbound-sdk/sync: scheduled runs that fetch only what changed.
//
// It keeps one checkpoint per collection in a store you supply: a cursor, so
// a run that dies restarts on the page it was reading, and a high-water mark,
// so the next run asks only for newer records. Nothing is stored on our side.

import type { Entity } from "../internal/entities-account.ts";
import { OutboundError } from "../internal/errors.ts";
import type {
  CampaignFilters,
  LeadFilters,
  ListAll,
  OutboundApi,
} from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { parseScope } from "../internal/scope/rule.ts";
import { stableId } from "../internal/sha256.ts";
import { runScoped } from "./scoped.ts";
import type {
  Checkpoint,
  CheckpointStore,
  SyncCollection,
  SyncExtension,
  SyncFilter,
  SyncOptions,
  SyncPluginOptions,
  SyncResult,
} from "./types.ts";

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

interface Walk {
  readonly since: string | undefined;
  readonly filter: SyncFilter;
  readonly start: (cursor: string | undefined) => ListAll<Entity>;
}

const SINCE_CAPABILITY = {
  leads: "leads.since",
  messages: "messages.since",
  replies: "replies.since",
} as const;

const walkFor = <Item extends Entity>(
  outbound: OutboundApi,
  collection: SyncCollection,
  options: SyncOptions<Item>,
  since: string | undefined
): Walk => {
  const { campaignId, limit } = options;
  const dated = collection !== "campaigns" && collection !== "senders";

  const grade = dated
    ? outbound.capabilities[SINCE_CAPABILITY[collection]]
    : false;

  const filter = grade !== false;

  const range: LeadFilters & CampaignFilters = filter
    ? { campaignId, since }
    : { campaignId };

  return {
    filter: grade === false || since === undefined ? "none" : grade,
    since: filter ? since : undefined,
    start: (cursor) => {
      switch (collection) {
        case "campaigns": {
          return outbound.campaigns.listAll({ cursor, limit });
        }

        case "senders": {
          return outbound.senders.listAll({ campaignId, cursor, limit });
        }

        case "leads": {
          return outbound.leads.listAll({ ...range, cursor, limit });
        }

        case "messages": {
          return outbound.messages.listAll({ ...range, cursor, limit });
        }

        default: {
          return outbound.replies.listAll({ ...range, cursor, limit });
        }
      }
    },
  };
};

interface Runner {
  readonly outbound: OutboundApi;
  readonly store: CheckpointStore;
  readonly overlapMs: number;
  readonly now: () => number;
}

const keyFor = (
  outbound: OutboundApi,
  collection: SyncCollection,
  campaignId?: string
): string =>
  `outbound-sync:${stableId(outbound.provider, outbound.workspaceId, collection, campaignId)}`;

const overlapped = (
  since: string | undefined,
  overlapMs: number
): string | undefined =>
  since === undefined
    ? undefined
    : new Date(Date.parse(since) - overlapMs).toISOString();

const runSync = async <Item extends Entity>(
  runner: Runner,
  collection: SyncCollection,
  options: SyncOptions<Item>
): Promise<SyncResult> => {
  const { now, outbound, overlapMs, store } = runner;
  assertCollection(outbound, collection);
  const key = keyFor(outbound, collection, options.campaignId);
  const previous = (await store.get(key)) ?? {};
  const startedAt = previous.startedAt ?? new Date(now()).toISOString();

  const walk = walkFor(
    outbound,
    collection,
    options,
    overlapped(previous.since, overlapMs)
  );

  const iterator = walk.start(previous.cursor);
  let page: Item[] = [];
  let pages = 0;
  let records = 0;
  let lastCursor = previous.cursor;

  const flush = async (): Promise<void> => {
    await options.onPage(page);
    records += page.length;
    pages += 1;
    page = [];
    lastCursor = iterator.cursor;
    // Saved after the page is handled, so a crash replays it and never skips it.
    await store.set(key, {
      cursor: lastCursor,
      since: previous.since,
      startedAt,
    });
  };

  const result = (complete: boolean): SyncResult => {
    const requests = iterator.meta?.requests ?? 0;

    return {
      collection,
      complete,
      filter: walk.filter,
      notes:
        walk.filter === "client"
          ? [
              `${outbound.provider} cannot filter ${collection} by date, so this run read every record (${requests} requests) and kept the ${records} created since ${walk.since ?? ""}. A record created earlier and changed since is not read again: reset the checkpoint on a schedule to pick those up.`,
            ]
          : [],
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

  // The run finished: the next one starts from when this one began.
  await store.set(key, { since: startedAt });

  return result(true);
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
          const scope = parseScope(runOptions, "sync");

          if (scope === null) {
            return await runSync(runner, collection, runOptions);
          }

          if (runOptions.campaignId !== undefined) {
            throw new OutboundError(
              "Invalid",
              "sync: give campaignId or a campaign scope (campaign_ids, tag, campaign_name), not both",
              { provider: outbound.provider }
            );
          }

          return await runScoped(
            (each, perCampaign) => runSync(runner, each, perCampaign),
            outbound,
            collection,
            runOptions,
            scope
          );
        },
      },
    };
  },
  name: "sync",
});
