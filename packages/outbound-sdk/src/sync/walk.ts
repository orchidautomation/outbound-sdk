// How a sync run walks one collection: the listing it reads, the key its
// checkpoint is kept under, and how far back it reaches.

import type { Entity } from "../internal/entities-account.ts";
import type {
  CampaignFilters,
  LeadFilters,
  ListAll,
  OutboundApi,
} from "../internal/outbound/api.ts";
import { stableId } from "../internal/sha256.ts";
import type {
  Checkpoint,
  CheckpointStore,
  SyncCollection,
  SyncFilter,
  SyncOptions,
} from "./types.ts";

export interface Walk {
  readonly since: string | undefined;
  readonly filter: SyncFilter;
  readonly start: (cursor: string | undefined) => ListAll<Entity>;
}

const SINCE_CAPABILITY = {
  leads: "leads.since",
  messages: "messages.since",
  replies: "replies.since",
} as const;

export const walkFor = (
  outbound: OutboundApi,
  collection: SyncCollection,
  options: Pick<SyncOptions, "campaignId" | "include" | "limit">,
  since: string | undefined
): Walk => {
  const { campaignId, include, limit } = options;
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
          return outbound.messages.listAll({
            ...range,
            cursor,
            include,
            limit,
          });
        }

        default: {
          return outbound.replies.listAll({ ...range, cursor, include, limit });
        }
      }
    },
  };
};

export interface Runner {
  readonly outbound: OutboundApi;
  readonly store: CheckpointStore;
  readonly overlapMs: number;
  readonly now: () => number;
}

export const keyFor = (
  outbound: OutboundApi,
  collection: SyncCollection,
  campaignId?: string
): string =>
  `outbound-sync:${stableId(outbound.provider, outbound.workspaceId, collection, campaignId)}`;

/** Where a run starts: its cursor, the lower bound it asks for, and whether it goes on from the last walk's end. */
export interface Start {
  readonly cursor: string | undefined;
  readonly since: string | undefined;
  readonly fromTail: boolean;
}

/**
 * A finished run of leads on a listing in creation order goes on from the
 * end of the last walk, so it reads only leads created since; any other run
 * resumes its cursor or starts over. `since` reaches back by the overlap
 * either way, so the page the last walk ended on keeps only newer leads.
 */
export const startFor = (
  outbound: OutboundApi,
  collection: SyncCollection,
  previous: Checkpoint,
  overlapMs: number
): Start => {
  const fromTail =
    collection === "leads" &&
    outbound.capabilities["leads.createdOrder"] &&
    previous.cursor === undefined &&
    previous.since !== undefined &&
    previous.tail !== undefined;

  return {
    cursor: fromTail ? previous.tail : previous.cursor,
    fromTail,
    since: overlapped(previous.since, overlapMs),
  };
};

/** The note of a run that read only the leads created after the last walk's end. */
export const tailNote = (
  provider: string,
  requests: number,
  records: number
): string =>
  `${provider} lists leads in creation order, so this run read on from the end of the last walk (${requests} requests) and kept the ${records} created since, instead of reading every lead. Changes to earlier leads and deletions are not read: reset the checkpoint on a schedule for a full walk.`;

export const overlapped = (
  since: string | undefined,
  overlapMs: number
): string | undefined =>
  since === undefined
    ? undefined
    : new Date(Date.parse(since) - overlapMs).toISOString();

/** The note of a run whose date filter the SDK applied after reading every record. */
export const dateNote = (
  provider: string,
  collection: SyncCollection,
  walk: Walk,
  requests: number,
  records: number
): string[] =>
  walk.filter === "client"
    ? [
        `${provider} cannot filter ${collection} by date, so this run read every record (${requests} requests) and kept the ${records} created since ${walk.since ?? ""}. A record created earlier and changed since is not read again: reset the checkpoint on a schedule to pick those up.`,
      ]
    : [];
