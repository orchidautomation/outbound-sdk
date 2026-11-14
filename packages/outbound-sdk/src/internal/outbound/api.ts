// The public surface of an Outbound instance, as types. The class in
// outbound.ts implements it; plugins are written against it.

import type { TimeRange } from "../adapter.ts";
import type { Capabilities } from "../capabilities.ts";
import type { LimitsSnapshot, OperationOptions } from "../engine/engine.ts";
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
import type { Json } from "../json.ts";

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
}

export interface SenderFilters {
  readonly campaignId?: string | undefined;
}

export interface LeadFilters extends TimeRange {
  readonly campaignId?: string | undefined;
}

export interface MessageFilters extends TimeRange {
  readonly campaignId?: string | undefined;
  readonly leadId?: string | undefined;
  readonly include?: readonly Include[] | undefined;
}

export interface ReplyFilters extends TimeRange {
  readonly campaignId?: string | undefined;
  readonly category?: ReplyCategory | undefined;
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
  /** The campaign or sender, for the `campaign`, `step` and `sender` scopes. */
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
  readonly senders: ReadCollection<Sender, Scoped<SenderFilters, "campaignId">>;
  readonly leads: ReadCollection<Lead, Scoped<LeadFilters, "campaignId">>;
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
  readonly stats: (options?: StatsOptions) => Promise<StatsResult>;
  readonly warmup: (
    options?: OperationOptions
  ) => Promise<NonNullable<Sender["warmup"]>>;
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
  /** How far the adapter has been verified. */
  readonly maturity: "beta" | "stable" | "unverified";
  /** What the adapter assumes and has not confirmed against the live API. */
  readonly caveats: readonly string[];
  readonly campaigns: Collection<Campaign, CampaignFilters>;
  readonly senders: Collection<Sender, SenderFilters>;
  readonly leads: Collection<Lead, LeadFilters>;
  readonly messages: ReadCollection<Message, MessageFilters>;
  readonly replies: ReadCollection<Reply, ReplyFilters>;
  readonly workspaces: ReadCollection<Workspace, Record<never, never>>;
  readonly raw: RawClient;
  readonly campaign: (id: string) => CampaignHandle;
  readonly sender: (id: string) => SenderHandle;
  readonly lead: (id: string) => LeadHandle;
  /** The same API scoped to one client or workspace. */
  readonly workspace: (id: string) => OutboundApi;
  readonly stats: (options?: TopLevelStatsOptions) => Promise<StatsResult>;
  /** The current rate budget for this credential. */
  readonly limits: () => Promise<LimitsSnapshot[]>;
  /** How many vendor requests a read would cost, before making it. */
  readonly estimate: (query: EstimateQuery) => Estimate;
}
