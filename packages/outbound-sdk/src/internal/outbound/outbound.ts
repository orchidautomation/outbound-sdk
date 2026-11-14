// The Outbound class: one instance wraps one adapter. The wrapper, not the
// adapter, owns capability gating, retries, throttling, hooks and plugins.

import type { Adapter } from "../adapter.ts";
import { resolveCapabilities } from "../capabilities.ts";
import type { Capabilities } from "../capabilities.ts";
import { RequestEngine } from "../engine/engine.ts";
import type { LimitsSnapshot, OperationOptions } from "../engine/engine.ts";
import type { RateLimitStore } from "../engine/rate-store.ts";
import type { Runtime } from "../engine/runtime.ts";
import type {
  Campaign,
  Lead,
  Message,
  Reply,
  Sender,
  Workspace,
} from "../entities.ts";
import { OutboundError } from "../errors.ts";
import { mergeHooks } from "../hooks.ts";
import type { OutboundHooks } from "../hooks.ts";
import type {
  CampaignFilters,
  CampaignHandle,
  Collection,
  Estimate,
  EstimateQuery,
  LeadFilters,
  LeadHandle,
  MessageFilters,
  OutboundApi,
  RawClient,
  ReadCollection,
  ReplyFilters,
  SenderFilters,
  SenderHandle,
  StatsResult,
  TopLevelStatsOptions,
} from "./api.ts";
import { makeCollection, makeReadCollection } from "./collections.ts";
import type { Core } from "./core.ts";
import {
  makeCampaignHandle,
  makeLeadHandle,
  makeSenderHandle,
} from "./handles.ts";
import { dispatch } from "./operations.ts";
import {
  assertUniquePluginNames,
  composeOperations,
  narrowCapabilities,
} from "./plugins.ts";
import type { OutboundPlugin } from "./plugins.ts";
import { makeRawClient } from "./raw.ts";
import {
  campaignGet,
  campaignList,
  leadGet,
  leadList,
  messageList,
  replyList,
  senderGet,
  senderList,
  workspaceList,
} from "./specs.ts";
import { readStats } from "./stats.ts";

export interface OutboundOptions extends OperationOptions {
  readonly adapter: Adapter;
  /** `plugins[0]` is the outermost layer. */
  readonly plugins?: readonly OutboundPlugin[] | undefined;
  readonly hooks?: OutboundHooks | undefined;
  /** Where rate budgets are counted. Defaults to this process's memory. */
  readonly rateLimitStore?: RateLimitStore | undefined;
  /** The fraction of each vendor's published limit to use. Defaults to 0.5. */
  readonly share?: number | undefined;
  /** Lets `raw` send requests that are not reads. Off by default. */
  readonly allowWrites?: boolean | undefined;
  /** A replacement for the global `fetch`. */
  readonly fetch?: typeof fetch | undefined;
  /** Replaces the clock, timers and randomness. Meant for tests. */
  readonly runtime?: Partial<Runtime> | undefined;
}

const engineFor = (options: OutboundOptions): RequestEngine =>
  new RequestEngine({
    defaults: {
      deadline: options.deadline,
      maxRequests: options.maxRequests,
      retries: options.retries,
      signal: options.signal,
      timeout: options.timeout,
    },
    hooks: mergeHooks([
      options.hooks,
      ...(options.plugins ?? []).map((plugin) => plugin.hooks),
    ]),
    runtime:
      options.fetch === undefined
        ? options.runtime
        : { ...options.runtime, fetch: options.fetch },
    share: options.share,
    store: options.rateLimitStore,
  });

export class Outbound implements OutboundApi {
  readonly #core: Core;
  readonly #options: OutboundOptions;
  readonly #plugins: readonly OutboundPlugin[];
  readonly campaigns: Collection<Campaign, CampaignFilters>;
  readonly senders: Collection<Sender, SenderFilters>;
  readonly leads: Collection<Lead, LeadFilters>;
  readonly messages: ReadCollection<Message, MessageFilters>;
  readonly replies: ReadCollection<Reply, ReplyFilters>;
  readonly workspaces: ReadCollection<Workspace, Record<never, never>>;
  readonly raw: RawClient;

  constructor(
    options: OutboundOptions,
    engine: RequestEngine = engineFor(options)
  ) {
    const { adapter } = options;
    const plugins = options.plugins ?? [];
    assertUniquePluginNames(plugins);
    const declared = resolveCapabilities(adapter.capabilities);
    const narrowed = narrowCapabilities(declared, plugins);

    const run = composeOperations(plugins, (operation, info) =>
      dispatch(
        {
          adapter,
          capabilities: declared,
          ctx: engine.contextFor(adapter, info.state),
        },
        operation
      )
    );

    this.#options = options;
    this.#plugins = plugins;
    this.#core = {
      adapter,
      allowWrites: options.allowWrites ?? false,
      engine,
      gate: { ...narrowed, provider: adapter.name },
      run,
    };
    this.campaigns = makeCollection(
      this.#core,
      campaignList(this.#core),
      campaignGet()
    );
    this.senders = makeCollection(
      this.#core,
      senderList(this.#core),
      senderGet(this.#core)
    );
    this.leads = makeCollection(
      this.#core,
      leadList(this.#core),
      leadGet(this.#core)
    );
    this.messages = makeReadCollection(this.#core, messageList(this.#core));
    this.replies = makeReadCollection(this.#core, replyList(this.#core));
    this.workspaces = makeReadCollection(this.#core, workspaceList(this.#core));
    this.raw = makeRawClient(this.#core);
  }

  get provider(): string {
    return this.#core.adapter.name;
  }

  get workspaceId(): string {
    return this.#core.adapter.workspaceId;
  }

  get capabilities(): Capabilities {
    return { ...this.#core.gate.capabilities };
  }

  get maturity(): Adapter["maturity"] {
    return this.#core.adapter.maturity;
  }

  get caveats(): readonly string[] {
    return this.#core.adapter.caveats ?? [];
  }

  /** The plugins on this instance, outermost first. */
  get plugins(): readonly OutboundPlugin[] {
    return this.#plugins;
  }

  campaign(id: string): CampaignHandle {
    return makeCampaignHandle(this.#core, id);
  }

  sender(id: string): SenderHandle {
    return makeSenderHandle(this.#core, id);
  }

  lead(id: string): LeadHandle {
    return makeLeadHandle(this.#core, id);
  }

  workspace(id: string): Outbound {
    const { adapter, engine } = this.#core;

    if (adapter.members === undefined && adapter.workspaceId === id) {
      return this;
    }

    const member = adapter.members?.find(
      (candidate) => candidate.workspaceId === id
    );

    if (member === undefined) {
      throw new OutboundError(
        "NotFound",
        `Workspace ${id} is not on this instance`,
        {
          provider: adapter.name,
        }
      );
    }

    return new Outbound({ ...this.#options, adapter: member }, engine);
  }

  stats(options?: TopLevelStatsOptions): Promise<StatsResult> {
    return readStats(this.#core, options);
  }

  limits(): Promise<LimitsSnapshot[]> {
    const { adapter, engine } = this.#core;

    return Promise.all(
      (adapter.members ?? [adapter]).map((member) => engine.limits(member))
    );
  }

  estimate(query: EstimateQuery): Estimate {
    const cost = this.#core.adapter.costs?.[query.action];

    if (cost === undefined) {
      return {
        basis: `${this.provider} declares no cost for ${query.action}`,
        requests: null,
      };
    }

    const pageSize = query.limit ?? cost.pageSize;

    if (query.records === undefined || pageSize === undefined) {
      return { basis: `${cost.perPage} request(s) per page`, requests: null };
    }

    const pages = Math.max(1, Math.ceil(query.records / pageSize));

    const requests =
      pages * cost.perPage + query.records * (cost.perRecord ?? 0);

    return {
      basis: `${pages} page(s) of ${pageSize} at ${cost.perPage} request(s) each, plus ${cost.perRecord ?? 0} per record`,
      requests,
    };
  }
}
