// The public surface of an Outbound instance, as types. The class in
// outbound.ts implements it; plugins are written against it.

import type { TimeRange } from "../adapter.ts";
import type { Capabilities } from "../capabilities.ts";
import type { LimitsSnapshot, OperationOptions } from "../engine/engine.ts";
import type {
  BlockEntry,
  CampaignProgress,
  CampaignSettings,
  LeadList,
  PlacementTest,
  SenderHealth,
  Tag,
  WebhookSubscription,
} from "../entities-account.ts";
import type {
  Campaign,
  CampaignStatus,
  Evidence,
  Lead,
  Message,
  MetricRow,
  MetricScope,
  Reply,
  ReplyCategory,
  Sender,
  Sequence,
  Workspace,
} from "../entities.ts";
import type { OutboundError } from "../errors.ts";
import type { FieldCoverage } from "../fields.ts";
import type { Json } from "../json.ts";
import type {
  NativeCatalog,
  NativeParamsOf,
  NeedsParams,
  NoNative,
} from "../native.ts";

export interface ResultMeta {
  /** `exact` from the vendor, `sampled` when partial, `derived` when we computed or filtered it. */
  readonly evidence: Evidence;
  /** When the SDK got the answer, ISO 8601 UTC. */
  readonly fetchedAt: string;
  /** `false` when more pages exist or a filter could not see everything. */
  readonly complete: boolean;
  /** Milliseconds spent waiting for the rate budget. */
  readonly throttledMs: number;
  /** Vendor requests the call made. */
  readonly requests: number;
  readonly provider: string;
  readonly workspaceId: string;
  /** `true` when an older answer was served because the vendor was down. */
  readonly stale: boolean;
  /** What the adapter left out, and why: a vendor value it could not use, mapped to `null`. */
  readonly notes: readonly string[];
}

export type WithMeta<Item> = Item & { readonly meta: ResultMeta };

export interface PageResult<Item> {
  readonly items: readonly Item[];
  /** Pass back to `list` or `listAll` to continue. Absent on the last page. */
  readonly cursor?: string | undefined;
  readonly complete: boolean;
  readonly meta: ResultMeta;
}

export interface ListOptions extends OperationOptions {
  /** A page size hint. Adapters clamp it to what the vendor allows. */
  readonly limit?: number | undefined;
  /** A cursor from an earlier page of the same listing. */
  readonly cursor?: string | undefined;
}

export interface ListAllOptions extends ListOptions {
  /** Stop after this many records. */
  readonly max?: number | undefined;
}

/** An async iterator over every page, with a cursor you can resume from. */
export interface ListAll<Item> extends AsyncIterable<Item> {
  /** The cursor after the last page fetched. `undefined` before the first page and at the end. */
  readonly cursor: string | undefined;
  /** The meta of the last page fetched. */
  readonly meta: ResultMeta | undefined;
  /** `true` once `max` stopped the walk while more records existed. */
  readonly truncated: boolean;
  /** Collects every record into an array. */
  readonly toArray: () => Promise<Item[]>;
}

export interface BulkOptions extends OperationOptions {
  /** How many records to fetch at once. Defaults to 4. */
  readonly concurrency?: number | undefined;
}

/** Partial failure is data, not an exception. */
export interface BulkResult<Item> {
  readonly results: readonly {
    readonly id: string;
    readonly value: WithMeta<Item>;
  }[];
  readonly errors: readonly {
    readonly id: string;
    readonly error: OutboundError;
  }[];
}

export interface ReadCollection<Item, Filters> {
  /** One page. */
  readonly list: (options?: Filters & ListOptions) => Promise<PageResult<Item>>;
  /** Every page, fetched under the rate budget as you iterate. */
  readonly listAll: (options?: Filters & ListAllOptions) => ListAll<Item>;
}

export interface Collection<Item, Filters> extends ReadCollection<
  Item,
  Filters
> {
  /** Throws `NotFound` for a missing record. */
  readonly get: (
    id: string,
    options?: OperationOptions
  ) => Promise<WithMeta<Item>>;
  /** Never throws for a missing record. */
  readonly exists: (id: string, options?: OperationOptions) => Promise<boolean>;
  readonly getMany: (
    ids: readonly string[],
    options?: BulkOptions
  ) => Promise<BulkResult<Item>>;
}

/** Fields that cost extra vendor requests and are fetched only when asked for. */
export type Include = "body";

export interface CampaignFilters {
  readonly status?: CampaignStatus | undefined;
  /** Only the campaigns this sender is attached to. */
  readonly senderId?: string | undefined;
}

export interface SenderFilters {
  readonly campaignId?: string | undefined;
}

export interface LeadFilters extends TimeRange {
  readonly campaignId?: string | undefined;
  /** A saved lead list. Not together with `campaignId`. */
  readonly listId?: string | undefined;
  /** Only the records of the person with exactly this email address. */
  readonly email?: string | undefined;
  /** Only the records of the person with exactly this LinkedIn profile. */
  readonly linkedinUrl?: string | undefined;
  /** Only the records whose email address is at exactly this domain, such as `acme.com`. Needs `leads.byDomain`. */
  readonly domain?: string | undefined;
}

export interface WebhookFilters {
  readonly campaignId?: string | undefined;
}

export interface MessageFilters extends TimeRange {
  readonly campaignId?: string | undefined;
  readonly leadId?: string | undefined;
  /** A `threadId` from an earlier message. */
  readonly threadId?: string | undefined;
  readonly include?: readonly Include[] | undefined;
}

export interface ReplyFilters extends TimeRange {
  readonly campaignId?: string | undefined;
  readonly category?: ReplyCategory | undefined;
  /** `true` for unread replies only, `false` for read ones only. */
  readonly unread?: boolean | undefined;
  readonly include?: readonly Include[] | undefined;
}

export interface StatsOptions extends OperationOptions {
  /** Inclusive `YYYY-MM-DD`. */
  readonly from?: string | undefined;
  /** Inclusive `YYYY-MM-DD`. */
  readonly to?: string | undefined;
  /** `total` for one row over the range, `day` for one row per day. */
  readonly by?: "day" | "total" | undefined;
}

export interface TopLevelStatsOptions extends StatsOptions {
  readonly scope?: MetricScope | undefined;
  /**
   * The campaign or sender, for the `campaign`, `step` and `sender` scopes.
   * The `campaign` scope without one returns a row per campaign, in one call.
   */
  readonly scopeId?: string | undefined;
}

export interface StatsResult {
  readonly rows: readonly MetricRow[];
  readonly meta: ResultMeta;
}

type Scoped<Filters, Key extends keyof Filters> = Omit<Filters, Key>;

export interface CampaignHandle {
  readonly id: string;
  readonly get: (options?: OperationOptions) => Promise<WithMeta<Campaign>>;
  readonly sequence: (
    options?: OperationOptions
  ) => Promise<WithMeta<Sequence>>;
  /** The schedule, daily caps, tracking and stop rules. */
  readonly settings: (
    options?: OperationOptions
  ) => Promise<WithMeta<CampaignSettings>>;
  /** How many of the campaign's leads are waiting, in progress, finished or stopped. */
  readonly progress: (
    options?: OperationOptions
  ) => Promise<WithMeta<CampaignProgress>>;
  /** The follow-up sequences attached to the campaign. */
  readonly subsequences: ReadCollection<Sequence, Record<never, never>>;
  readonly webhooks: ReadCollection<WebhookSubscription, Record<never, never>>;
  readonly senders: ReadCollection<Sender, Scoped<SenderFilters, "campaignId">>;
  readonly leads: ReadCollection<
    Lead,
    Scoped<LeadFilters, "campaignId" | "listId">
  >;
  readonly messages: ReadCollection<
    Message,
    Scoped<MessageFilters, "campaignId">
  >;
  readonly replies: ReadCollection<Reply, Scoped<ReplyFilters, "campaignId">>;
  /** Totals, or one row per day or per step. */
  readonly stats: (
    options?: StatsOptions & {
      readonly scope?: "campaign" | "step" | undefined;
    }
  ) => Promise<StatsResult>;
}

export interface SenderHandle {
  readonly id: string;
  readonly get: (options?: OperationOptions) => Promise<WithMeta<Sender>>;
  /** The campaigns the sender is attached to. */
  readonly campaigns: ReadCollection<
    Campaign,
    Scoped<CampaignFilters, "senderId">
  >;
  readonly stats: (options?: StatsOptions) => Promise<StatsResult>;
  readonly warmup: (
    options?: OperationOptions
  ) => Promise<NonNullable<Sender["warmup"]>>;
  /** DNS records, connection state and warmup traffic. */
  readonly health: (
    options?: OperationOptions
  ) => Promise<WithMeta<SenderHealth>>;
}

export interface ListHandle {
  readonly id: string;
  readonly get: (options?: OperationOptions) => Promise<WithMeta<LeadList>>;
  readonly leads: ReadCollection<
    Lead,
    Scoped<LeadFilters, "campaignId" | "listId">
  >;
}

export interface ThreadHandle {
  readonly id: string;
  /** Every message of the conversation, oldest first. */
  readonly messages: (
    options?: OperationOptions & {
      readonly include?: readonly Include[] | undefined;
    }
  ) => Promise<PageResult<Message>>;
}

export interface LeadHandle {
  readonly id: string;
  readonly get: (options?: OperationOptions) => Promise<WithMeta<Lead>>;
  /** Every message to and from the lead, oldest first. */
  readonly timeline: (
    options?: OperationOptions & {
      readonly include?: readonly Include[] | undefined;
    }
  ) => Promise<PageResult<Message>>;
}

export interface RawRequestOptions extends OperationOptions {
  readonly query?:
    | Readonly<Record<string, string | number | boolean | undefined>>
    | undefined;
  readonly body?: Json | undefined;
  readonly lane?: string | undefined;
}

/** The vendor's own API, for anything not normalized yet. Reads only unless `allowWrites` is set. */
export interface RawClient {
  readonly provider: string;
  readonly get: (path: string, options?: RawRequestOptions) => Promise<Json>;
  readonly request: (
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    path: string,
    options?: RawRequestOptions
  ) => Promise<Json>;
}

export type NativeParams = Readonly<Record<string, Json | undefined>>;

export interface NativeResult {
  /** The vendor's response, as it was sent. Not normalized and not redacted. */
  readonly data: Json;
  readonly meta: ResultMeta;
}

type NativeArguments<Read> =
  NeedsParams<Read> extends true
    ? [params: NativeParamsOf<Read>, options?: OperationOptions]
    : [params?: NativeParamsOf<Read>, options?: OperationOptions];

/** One function per catalogued read, typed from the adapter's catalog. */
export type NativeReads<Native> = {
  readonly [Name in keyof Native]: (
    ...args: NativeArguments<Native[Name]>
  ) => Promise<NativeResult>;
};

/**
 * The vendor's own reads that have no normalized form. Every one is a read:
 * the catalog holds nothing that changes vendor data. Each call is one vendor
 * request; pass the vendor's own paging parameters to page.
 */
export interface NativeClient<Native extends NativeCatalog = NoNative> {
  readonly provider: string;
  /** What this vendor offers beyond the normalized reads, with each read's parameters. */
  readonly catalog: Native;
  /** The reads as typed functions: `outbound.native.reads.inboxUnread({ limit: 20 })`. */
  readonly reads: NativeReads<Native>;
  /** A read by name, for callers that learn the name at run time. */
  readonly read: (
    name: string,
    params?: NativeParams,
    options?: OperationOptions
  ) => Promise<NativeResult>;
}

export interface EstimateQuery {
  /** The listing or lookup to estimate, for example `leads.list`. */
  readonly action: string;
  /** How many records you expect to read. */
  readonly records?: number | undefined;
  readonly limit?: number | undefined;
}

export interface Estimate {
  /** Expected vendor requests, or `null` when it cannot be known up front. */
  readonly requests: number | null;
  readonly basis: string;
}

export interface OutboundApi {
  readonly provider: string;
  readonly workspaceId: string;
  /** What this instance can do, after plugins narrowed it. */
  readonly capabilities: Capabilities;
  /** The plugins on this instance, outermost first. */
  readonly plugins: readonly { readonly name: string }[];
  /** How far the adapter has been verified. */
  readonly maturity: "beta" | "stable" | "unverified";
  /** What the adapter assumes and has not confirmed against the live API. */
  readonly caveats: readonly string[];
  /**
   * Which fields of each record this adapter fills: `exact` from the vendor,
   * `derived` by the adapter, or `false` when a `null` means the vendor has no
   * such field.
   */
  readonly fields: FieldCoverage;
  readonly campaigns: Collection<Campaign, CampaignFilters>;
  readonly senders: Collection<Sender, SenderFilters>;
  readonly leads: Collection<Lead, LeadFilters>;
  readonly messages: ReadCollection<Message, MessageFilters>;
  readonly replies: ReadCollection<Reply, ReplyFilters>;
  readonly workspaces: ReadCollection<Workspace, Record<never, never>>;
  /** Saved lead lists. */
  readonly lists: Collection<LeadList, Record<never, never>>;
  /** The addresses, domains and profiles the account never contacts. */
  readonly blocklist: ReadCollection<BlockEntry, Record<never, never>>;
  readonly tags: ReadCollection<Tag, Record<never, never>>;
  /** The inbox placement tests the account has set up. Their results are native reads. */
  readonly placementTests: ReadCollection<PlacementTest, Record<never, never>>;
  /** The webhooks registered with the vendor. */
  readonly webhooks: Collection<WebhookSubscription, WebhookFilters>;
  readonly raw: RawClient;
  /** The vendor's own reads, by name, for what has no normalized form. */
  readonly native: NativeClient;
  readonly campaign: (id: string) => CampaignHandle;
  readonly sender: (id: string) => SenderHandle;
  readonly lead: (id: string) => LeadHandle;
  /** One saved lead list. */
  readonly list: (id: string) => ListHandle;
  /** One conversation, by the `threadId` a message carries. */
  readonly thread: (id: string) => ThreadHandle;
  /** The same API scoped to one client or workspace. */
  readonly workspace: (id: string) => OutboundApi;
  readonly stats: (options?: TopLevelStatsOptions) => Promise<StatsResult>;
  /** The current rate budget for this credential. */
  readonly limits: () => Promise<LimitsSnapshot[]>;
  /** How many vendor requests a read would cost, before making it. */
  readonly estimate: (query: EstimateQuery) => Estimate;
}
