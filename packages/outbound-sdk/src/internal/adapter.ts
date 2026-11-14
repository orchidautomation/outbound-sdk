// The adapter contract. Adapters are thin: they describe each request and map
// the response. They never retry, sleep, walk pages or throw for an
// unsupported feature. The wrapper does all of that.

import type { CapabilityDeclaration } from "./capabilities.ts";
import type {
  BlockEntry,
  CampaignSettings,
  LeadList,
  SenderHealth,
  Tag,
  WebhookSubscription,
} from "./entities-account.ts";
import type {
  Campaign,
  CampaignStatus,
  Lead,
  Message,
  MetricRow,
  MetricScope,
  OutboundEvent,
  Reply,
  ReplyCategory,
  Sender,
  Sequence,
  Workspace,
} from "./entities.ts";
import type { ErrorMapper } from "./errors.ts";
import type { FieldCoverage, FieldDeclaration } from "./fields.ts";
import type { Json } from "./json.ts";
import type { LimitDeclaration } from "./limits.ts";
import type { NativeCatalog, NoNative } from "./native.ts";

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface RequestSpec {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: Json | undefined;
  /** A rate lane declared in the adapter's limits. Defaults to the global budget. */
  readonly lane?: string | undefined;
}

export interface VendorResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Json;
}

export interface AdapterContext {
  /** The only way an adapter touches the network. */
  readonly request: (spec: RequestSpec) => Promise<VendorResponse>;
  /** The context for another adapter, with that adapter's own rate budget. */
  readonly forAdapter: (adapter: Adapter) => AdapterContext;
}

/** One page from the vendor. `next` is whatever the adapter needs to continue. */
export interface Page<Item> {
  readonly items: readonly Item[];
  readonly next?: Json | undefined;
}

export interface PageQuery {
  /** A page size hint. Adapters clamp it to what the vendor allows. */
  readonly limit?: number | undefined;
  /** The `next` value from the previous page. */
  readonly next?: Json | undefined;
}

export interface CampaignQuery extends PageQuery {
  readonly status?: CampaignStatus | undefined;
  /** Only the campaigns this sender is attached to. */
  readonly senderId?: string | undefined;
}

export interface SenderQuery extends PageQuery {
  readonly campaignId?: string | undefined;
}

export interface TimeRange {
  /** Inclusive, ISO 8601 UTC. */
  readonly since?: string | undefined;
  /** Inclusive, ISO 8601 UTC. */
  readonly until?: string | undefined;
}

export interface LeadQuery extends PageQuery, TimeRange {
  readonly campaignId?: string | undefined;
  /** A saved lead list. Never set together with `campaignId`. */
  readonly listId?: string | undefined;
  /** Only the lead records with exactly this address, lowercased. One per campaign the person is in. */
  readonly email?: string | undefined;
  /** Only the lead records with exactly this LinkedIn profile URL. */
  readonly linkedinUrl?: string | undefined;
}

export interface MessageQuery extends PageQuery, TimeRange {
  readonly campaignId?: string | undefined;
  readonly leadId?: string | undefined;
  /** A `threadId` from an earlier message. */
  readonly threadId?: string | undefined;
  /** Bodies are expensive on some vendors, so they are fetched only on request. */
  readonly includeBody: boolean;
}

export interface ReplyQuery extends PageQuery, TimeRange {
  readonly campaignId?: string | undefined;
  readonly category?: ReplyCategory | undefined;
  /** `true` for unread replies only, `false` for read ones only. */
  readonly unread?: boolean | undefined;
  readonly includeBody: boolean;
}

export interface SubsequenceQuery extends PageQuery {
  readonly campaignId: string;
}

export interface WebhookQuery extends PageQuery {
  readonly campaignId?: string | undefined;
}

export interface StatsQuery {
  readonly scope: MetricScope;
  /**
   * The campaign or sender id. Not used for the workspace scope. The
   * campaign scope without one asks for a row per campaign.
   */
  readonly scopeId?: string | undefined;
  /** Inclusive `YYYY-MM-DD`. */
  readonly from?: string | undefined;
  /** Inclusive `YYYY-MM-DD`. */
  readonly to?: string | undefined;
  readonly by: "day" | "total";
}

/** What a webhook request looks like to a parser, read once by the caller. */
export interface WebhookRequest {
  readonly headers: Headers;
  readonly url: string;
  readonly rawBody: string;
  readonly body: Json;
}

export interface EventFormat {
  /** `true` when the payload looks like this vendor's webhook. */
  readonly detect: (request: WebhookRequest) => boolean;
  /**
   * Checks the vendor's signature. Omitted when the vendor does not sign;
   * the caller then relies on a shared secret in the URL or a header.
   */
  readonly verify?:
    | ((request: WebhookRequest, secret: string) => boolean)
    | undefined;
  readonly parse: (
    request: WebhookRequest,
    workspaceId: string
  ) => OutboundEvent[];
}

/** How the wrapper builds `outbound.raw`, the vendor's own API. */
export interface RawDescriptor {
  readonly baseUrl: string;
  /** Adds the credential to a request. */
  readonly authorize: (spec: RequestSpec) => RequestSpec;
  /**
   * `true` for a request that only reads. Some vendors list with POST, so the
   * method alone does not decide it. `path` is the path that will be sent,
   * relative to `baseUrl`: dot segments are resolved, repeated slashes are
   * collapsed and it has no query.
   */
  readonly isRead: (method: HttpMethod, path: string) => boolean;
  /**
   * `true` for a read whose response holds secrets: API keys, mailbox
   * passwords, proxy credentials. `raw` returns a response as it is, so these
   * are refused whatever the method and even when writes are allowed.
   */
  readonly isSecret?:
    | ((path: string, query: URLSearchParams) => boolean)
    | undefined;
}

export type Maturity = "beta" | "stable" | "unverified";

/** What a read costs in vendor requests, so a caller can estimate before reading. */
export interface OperationCost {
  /** Requests per page of a listing, or per lookup. */
  readonly perPage: number;
  /** The page size the adapter asks the vendor for. */
  readonly pageSize?: number | undefined;
  /** Extra requests per record, for example one per lead to fetch a body. */
  readonly perRecord?: number | undefined;
}

export interface Adapter<Native extends NativeCatalog = NoNative> {
  readonly name: string;
  /** A label for this credential's client or workspace. Part of every ref. */
  readonly workspaceId: string;
  /**
   * `unverified`: written from documentation and tested offline. `beta`: its
   * reads were run against a live account. `stable`: its fixtures are captured
   * responses and the live checks pass on a schedule.
   */
  readonly maturity: Maturity;
  /** Secrets the request engine must keep out of errors, hooks and logs. */
  readonly secrets: readonly string[];
  /** Omitted or partial: anything not declared is unsupported. */
  readonly capabilities?: CapabilityDeclaration | undefined;
  readonly limits: LimitDeclaration;
  readonly raw: RawDescriptor;
  readonly mapError: ErrorMapper;
  readonly events?: EventFormat | undefined;
  /** What is assumed and not yet confirmed against the live API. */
  readonly caveats?: readonly string[] | undefined;
  /**
   * The fields this adapter derives or never fills, by record. Omitted: every
   * field is one the vendor reports.
   */
  readonly fields?: FieldDeclaration | undefined;
  /**
   * Set by `combine()` in place of `fields`: the coverage of the members read
   * as one.
   */
  readonly fieldCoverage?: FieldCoverage | undefined;
  /** Request costs by operation kind, for `outbound.estimate()`. */
  readonly costs?: Readonly<Record<string, OperationCost>> | undefined;
  /**
   * The vendor's reads that have no normalized form, by name. With the
   * normalized reads they cover everything the vendor's API can report.
   */
  readonly native?: Native | undefined;
  /** Set by `combine()`: the adapters behind this one. */
  readonly members?: readonly Adapter[] | undefined;
  /**
   * Set by `combine()`: the adapter for one workspace label, or for one
   * member named as `provider:workspace`. When several members carry the
   * label, as a client on two tools does, it is those members combined.
   * `undefined` when no member matches.
   */
  readonly scope?: ((workspaceId: string) => Adapter | undefined) | undefined;

  // One page per call. The wrapper loops, throttles and retries.
  readonly listCampaigns: (
    query: CampaignQuery,
    ctx: AdapterContext
  ) => Promise<Page<Campaign>>;
  readonly getCampaign: (id: string, ctx: AdapterContext) => Promise<Campaign>;
  readonly getSequence?: (
    campaignId: string,
    ctx: AdapterContext
  ) => Promise<Sequence>;
  readonly listSenders?: (
    query: SenderQuery,
    ctx: AdapterContext
  ) => Promise<Page<Sender>>;
  readonly getSender?: (id: string, ctx: AdapterContext) => Promise<Sender>;
  readonly listLeads?: (
    query: LeadQuery,
    ctx: AdapterContext
  ) => Promise<Page<Lead>>;
  readonly getLead?: (id: string, ctx: AdapterContext) => Promise<Lead>;
  readonly listMessages?: (
    query: MessageQuery,
    ctx: AdapterContext
  ) => Promise<Page<Message>>;
  readonly listReplies?: (
    query: ReplyQuery,
    ctx: AdapterContext
  ) => Promise<Page<Reply>>;
  readonly stats?: (
    query: StatsQuery,
    ctx: AdapterContext
  ) => Promise<readonly MetricRow[]>;
  readonly listWorkspaces?: (
    query: PageQuery,
    ctx: AdapterContext
  ) => Promise<Page<Workspace>>;
  readonly getCampaignSettings?: (
    campaignId: string,
    ctx: AdapterContext
  ) => Promise<CampaignSettings>;
  readonly listSubsequences?: (
    query: SubsequenceQuery,
    ctx: AdapterContext
  ) => Promise<Page<Sequence>>;
  readonly getSenderHealth?: (
    senderId: string,
    ctx: AdapterContext
  ) => Promise<SenderHealth>;
  readonly listLists?: (
    query: PageQuery,
    ctx: AdapterContext
  ) => Promise<Page<LeadList>>;
  readonly getList?: (id: string, ctx: AdapterContext) => Promise<LeadList>;
  readonly listBlocklist?: (
    query: PageQuery,
    ctx: AdapterContext
  ) => Promise<Page<BlockEntry>>;
  readonly listTags?: (
    query: PageQuery,
    ctx: AdapterContext
  ) => Promise<Page<Tag>>;
  readonly listWebhooks?: (
    query: WebhookQuery,
    ctx: AdapterContext
  ) => Promise<Page<WebhookSubscription>>;
  readonly getWebhook?: (
    id: string,
    ctx: AdapterContext
  ) => Promise<WebhookSubscription>;
}
