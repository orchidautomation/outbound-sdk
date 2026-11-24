// The sync plugin's public types.

import type { Entity } from "../internal/entities-account.ts";
import type {
  ResolvedScope,
  ResolvedScopeMeta,
} from "../internal/scope/resolve.ts";
import type { ResolveScopeInput } from "../internal/scope/rule.ts";

export interface Checkpoint {
  /** Where an unfinished run stopped. Absent between runs. */
  readonly cursor?: string | undefined;
  /** The start time of the last run that finished, ISO 8601 UTC. */
  readonly since?: string | undefined;
  /** When the unfinished run started, kept so it can become `since`. */
  readonly startedAt?: string | undefined;
  /**
   * The ref (`provider:workspace:id`) of the campaign this checkpoint
   * covers. Absent for a checkpoint of the whole workspace.
   */
  readonly campaignRef?: string | undefined;
}

/** What `onPage` is told beside each page. */
export interface SyncPage {
  /**
   * The ref of the campaign the page was read for: the `campaignId` given,
   * or under a campaign scope the campaign being synced. `undefined` for a
   * page of the whole workspace, and for `campaigns` under a scope.
   */
  readonly campaignRef: string | undefined;
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
 * `campaign_ids`, `tag`, `campaign_name` and `statuses` sync only the
 * campaigns of a campaign scope, found as every insight finds them, before
 * any per-campaign read. Each campaign keeps its own checkpoint, under its ref.
 */
export interface SyncOptions<
  Item extends Entity = Entity,
> extends ResolveScopeInput {
  /** Sync one campaign's records only. Not with a campaign scope. */
  readonly campaignId?: string | undefined;
  /**
   * The scope's campaigns as `resolveScope` returned them, so runs of
   * several collections find them once. Not with `campaignId` or a
   * campaign scope. Accepted when `campaigns` is an array and
   * `meta.provider` and `meta.workspaceId` are this instance's; nothing else
   * is checked. Its campaigns sync in the order they are listed, so a
   * caller can reorder them, such as active ones first.
   */
  readonly resolved?: ResolvedScope | undefined;
  /** Receives each page. The checkpoint moves only after it resolves. */
  readonly onPage: (
    items: readonly Item[],
    page: SyncPage
  ) => void | Promise<void>;
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
   * Replies and messages tied to no campaign, such as HeyReach inbox
   * conversations, that this run did not reach: `null` when some were left
   * out and counting them would read the whole inbox, with a note; `0` where
   * the tool has no such inbox or the run reached it. A campaign's run, or
   * one under a scope, leaves out the inbox's replies and messages; a run of
   * the whole workspace only its replies, which `replies.list` reads only
   * with `includeInbox`.
   */
  readonly inboxLeftOut: number | null;
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

/**
 * Why a scoped run did not read a campaign. `cannot-open`: the tool lists
 * the campaign but answers `NotFound` to reading it, such as a HeyReach
 * draft it cannot open.
 */
export type SyncSkipReason = "cannot-open";

/** A campaign of the scope this run did not read. */
export interface SyncSkip {
  readonly reason: SyncSkipReason;
}

/** One campaign of a scoped run. */
export interface SyncCampaignResult {
  readonly campaignRef: string;
  readonly name: string | null;
  readonly records: number;
  readonly pages: number;
  /**
   * `false` when `maxPages` stopped the run before or during this
   * campaign, or when the run skipped it.
   */
  readonly complete: boolean;
  /** Set when the run did not read this campaign, with why. */
  readonly skipped?: SyncSkip | undefined;
}

/** What a run under a campaign scope adds to its result. */
export interface SyncScopeResult {
  /**
   * How the scope's campaigns were found, as `resolveScope` returns it.
   * With `resolved`, it is that one's, and the run's `requests` leave out
   * what finding the campaigns cost.
   */
  readonly meta: ResolvedScopeMeta;
  /** Each campaign of the scope, in the order synced. */
  readonly campaigns: readonly SyncCampaignResult[];
  /**
   * The refs of the campaigns this run skipped, each marked in `campaigns`.
   * The run's `complete` leaves them out: running again does not read
   * them, so a loop that runs until `complete` still ends.
   */
  readonly skipped: readonly string[];
  /**
   * The same as the result's `inboxLeftOut`: replies and messages tied to
   * no campaign, which a campaign scope cannot reach. `0` where the tool has
   * no such inbox or the collection has none, `null` where it has one and
   * counting it would mean reading every campaign's conversations, other
   * clients' included.
   */
  readonly inboxLeftOut: number | null;
}
