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
  options: Pick<SyncOptions, "campaignId" | "limit">,
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
