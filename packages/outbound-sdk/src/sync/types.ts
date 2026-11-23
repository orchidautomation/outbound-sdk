// The sync plugin's public types.

import type { Entity } from "../internal/entities-account.ts";
import type { ResolvedScopeMeta } from "../internal/scope/resolve.ts";
import type { CampaignScopeInput } from "../internal/scope/rule.ts";

export interface Checkpoint {
  /** Where an unfinished run stopped. Absent between runs. */
  readonly cursor?: string | undefined;
  /** The start time of the last run that finished, ISO 8601 UTC. */
  readonly since?: string | undefined;
  /** When the unfinished run started, kept so it can become `since`. */
  readonly startedAt?: string | undefined;
}

export interface CheckpointStore {
  readonly get: (key: string) => Promise<Checkpoint | undefined>;
  readonly set: (key: string, checkpoint: Checkpoint) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

export type SyncCollection =
  | "campaigns"
  | "leads"
  | "messages"
  | "replies"
  | "senders";

/**
 * `campaign_ids`, `tag` and `campaign_name` sync only the campaigns of a
 * campaign scope, found as every insight finds them, before any
 * per-campaign read. Each campaign keeps its own checkpoint, under its ref.
 */
export interface SyncOptions<
  Item extends Entity = Entity,
> extends CampaignScopeInput {
  /** Sync one campaign's records only. Not with a campaign scope. */
  readonly campaignId?: string | undefined;
  /** Receives each page. The checkpoint moves only after it resolves. */
  readonly onPage: (items: readonly Item[]) => void | Promise<void>;
  /** Stop after this many pages; the next run resumes from the checkpoint. */
  readonly maxPages?: number | undefined;
  /** Records per page. */
  readonly limit?: number | undefined;
}

export interface SyncResult {
  readonly collection: SyncCollection;
  readonly records: number;
  readonly pages: number;
  /** `true` when this run continued one that had not finished. */
  readonly resumed: boolean;
  /**
   * The lower bound this run asked for, when the collection can filter by
   * date. It is a creation time: a record created before it and changed
   * since is not read again.
   */
  readonly since: string | undefined;
  /** `false` when the run stopped at `maxPages` with more to read. */
  readonly complete: boolean;
  /** Vendor requests this run made. */
  readonly requests: number;
  /** Milliseconds this run waited for the rate budget. */
  readonly throttledMs: number;
  /**
   * Who applied `since`: `server` the vendor, so only newer records were
   * read; `client` the SDK, after reading every record, so the run cost a
   * full walk; `none` when no date filter applied (a first run, or a
   * collection with no date).
   */
  readonly filter: SyncFilter;
  /** What to know about this run, such as a date filter that cost a full walk. */
  readonly notes: readonly string[];
  /**
   * Under a campaign scope: how its campaigns were found and what each
   * synced. `since` is then the earliest lower bound of any campaign.
   */
  readonly scope?: SyncScopeResult | undefined;
}

export type SyncFilter = "client" | "none" | "server";

export interface SyncPluginOptions {
  readonly checkpoints: CheckpointStore;
  /**
   * How far each run reaches back before the last one, in minutes, because
   * new records can land mid-listing. Defaults to 5.
   */
  readonly overlapMinutes?: number | undefined;
  /** The clock, for tests. */
  readonly now?: (() => number) | undefined;
}

export interface SyncExtension {
  readonly sync: {
    // The item type follows the collection at the call site.
    readonly run: <Item extends Entity = Entity>(
      collection: SyncCollection,
      options: SyncOptions<Item>
    ) => Promise<SyncResult>;
    /** Forgets a collection's checkpoint, so the next run starts over. */
    readonly reset: (
      collection: SyncCollection,
      campaignId?: string
    ) => Promise<void>;
  };
}

/** One campaign of a scoped run. */
export interface SyncCampaignResult {
  readonly campaignRef: string;
  readonly name: string | null;
  readonly records: number;
  readonly pages: number;
  /** `false` when `maxPages` stopped the run before or during this campaign. */
  readonly complete: boolean;
}

/** What a run under a campaign scope adds to its result. */
export interface SyncScopeResult {
  /** How the scope's campaigns were found, as `resolveScope` returns it. */
  readonly meta: ResolvedScopeMeta;
  /** Each campaign of the scope, in the order synced. */
  readonly campaigns: readonly SyncCampaignResult[];
}
