// A complete adapter backed by data in memory. It tests the core without a
// network and powers demos.

import type {
  Adapter,
  LeadQuery,
  Page,
  PageQuery,
  TimeRange,
} from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { Channel } from "../internal/entities.ts";
import { makeErrorMapper, OutboundError } from "../internal/errors.ts";
import { isNumber } from "../internal/json.ts";
import { recordBase } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { assertWorkspaceId } from "../internal/ref.ts";
import {
  toBlockEntry,
  toHealth,
  toList,
  toSettings,
  toTag,
  toWebhook,
} from "./account.ts";
import {
  toCampaign,
  toLead,
  toMessage,
  toReply,
  toSender,
  toSequence,
  toSubsequence,
} from "./data.ts";
import type {
  MemoryCampaign,
  MemoryData,
  MemoryLead,
  MemoryMessage,
} from "./data.ts";
import { queryStats } from "./stats.ts";

export interface MemoryOptions {
  readonly data?: MemoryData | undefined;
  /** A label for this workspace. Defaults to `default`. */
  readonly workspaceId?: string | undefined;
  /** The provider name records carry. Defaults to `memory`. */
  readonly name?: string | undefined;
  /** Records per page. Defaults to 50. */
  readonly pageSize?: number | undefined;
  /** Overrides what the adapter declares, to exercise gating and fallbacks. */
  readonly capabilities?: CapabilityDeclaration | undefined;
}

const FULL_CAPABILITIES: CapabilityDeclaration = {
  blocklist: true,
  "campaigns.settings": true,
  "campaigns.status": "server",
  "leads.byCampaign": true,
  "leads.engagement": true,
  "leads.get": true,
  "leads.list": true,
  "leads.since": "server",
  "leads.timeline": true,
  "lists.leads": true,
  "lists.list": true,
  "messages.body": "full",
  "messages.byThread": true,
  "messages.list": true,
  "messages.since": "server",
  "replies.category": "vendor",
  "replies.list": true,
  "replies.since": "server",
  "senders.byCampaign": true,
  "senders.get": true,
  "senders.health": true,
  "senders.list": true,
  "senders.warmup": true,
  sequence: true,
  "sequence.subsequences": true,
  "stats.byDay": "exact",
  "stats.bySender": "exact",
  "stats.byStep": "exact",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  tags: true,
  "webhooks.list": true,
  workspaces: true,
};

const paginate = <Item>(
  items: readonly Item[],
  query: PageQuery,
  pageSize: number
): Page<Item> => {
  const offset = isNumber(query.next) ? query.next : 0;
  const size = Math.min(query.limit ?? pageSize, pageSize);
  const end = offset + size;

  return end < items.length
    ? { items: items.slice(offset, end), next: end }
    : { items: items.slice(offset, end) };
};

const within = (time: string | undefined, range: TimeRange): boolean =>
  time === undefined
    ? range.since === undefined && range.until === undefined
    : (range.since === undefined || time >= range.since) &&
      (range.until === undefined || time <= range.until);

const notFound = (provider: string, what: string, id: string): OutboundError =>
  new OutboundError("NotFound", `${what} ${id} was not found`, {
    provider,
    status: 404,
  });

interface Store {
  readonly identity: Identity;
  readonly data: MemoryData;
  readonly pageSize: number;
  readonly capabilities: CapabilityDeclaration;
  readonly channelOf: (campaignId: string | undefined) => Channel;
}

const findCampaign = (store: Store, id: string): MemoryCampaign => {
  const seed = store.data.campaigns?.find((campaign) => campaign.id === id);

  if (seed === undefined) {
    throw notFound(store.identity.provider, "Campaign", id);
  }

  return seed;
};

// A server-side filter applies only while the adapter declares it as one.
// Declaring `client` leaves the filtering to the wrapper.
const filtersByTime = (
  store: Store,
  key: "leads.since" | "messages.since" | "replies.since"
) => store.capabilities[key] === "server";

const selectMessages = (
  store: Store,
  query: TimeRange & {
    readonly campaignId?: string | undefined;
    readonly leadId?: string | undefined;
    readonly threadId?: string | undefined;
  },
  key: "messages.since" | "replies.since"
): MemoryMessage[] =>
  (store.data.messages ?? []).filter(
    (message) =>
      (query.campaignId === undefined ||
        message.campaignId === query.campaignId) &&
      (query.leadId === undefined || message.leadId === query.leadId) &&
      (query.threadId === undefined || message.threadId === query.threadId) &&
      (!filtersByTime(store, key) || within(message.sentAt, query))
  );

const selectLeads = (store: Store, query: LeadQuery): MemoryLead[] =>
  (store.data.leads ?? []).filter(
    (lead) =>
      (query.campaignId === undefined ||
        lead.campaignId === query.campaignId) &&
      (query.listId === undefined ||
        (lead.listIds ?? []).includes(query.listId)) &&
      (!filtersByTime(store, "leads.since") || within(lead.createdAt, query))
  );

type Getters = Pick<
  Adapter,
  "getCampaign" | "getLead" | "getSender" | "getSequence"
>;

const getters = (store: Store): Getters => {
  const { data, identity } = store;

  return {
    getCampaign: (id) =>
      Promise.resolve(toCampaign(identity, findCampaign(store, id))),
    getLead: (id) => {
      const seed = data.leads?.find((lead) => lead.id === id);

      return seed === undefined
        ? Promise.reject(notFound(identity.provider, "Lead", id))
        : Promise.resolve(toLead(identity, seed));
    },
    getSender: (id) => {
      const seed = data.senders?.find((sender) => sender.id === id);

      return seed === undefined
        ? Promise.reject(notFound(identity.provider, "Sender", id))
        : Promise.resolve(toSender(identity, seed));
    },
    getSequence: (id) =>
      Promise.resolve(toSequence(identity, findCampaign(store, id))),
  };
};

type Listers = Pick<
  Adapter,
  | "listCampaigns"
  | "listLeads"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "listWorkspaces"
  | "stats"
>;

const listers = (store: Store): Listers => {
  const { data, identity, pageSize } = store;

  return {
    listCampaigns: (query) => {
      const filterHere = store.capabilities["campaigns.status"] === "server";

      const seeds = (data.campaigns ?? []).filter(
        (campaign) =>
          !filterHere ||
          query.status === undefined ||
          (campaign.status ?? "active") === query.status
      );

      return Promise.resolve(
        paginate(
          seeds.map((seed) => toCampaign(identity, seed)),
          query,
          pageSize
        )
      );
    },
    listLeads: (query) => {
      const seeds = selectLeads(store, query);

      return Promise.resolve(
        paginate(
          seeds.map((seed) => toLead(identity, seed)),
          query,
          pageSize
        )
      );
    },
    listMessages: (query) =>
      Promise.resolve(
        paginate(
          selectMessages(store, query, "messages.since").map((seed) =>
            toMessage(
              identity,
              seed,
              store.channelOf(seed.campaignId),
              query.includeBody
            )
          ),
          query,
          pageSize
        )
      ),
    listReplies: (query) =>
      Promise.resolve(
        paginate(
          selectMessages(store, query, "replies.since")
            .filter(
              (seed) =>
                seed.direction === "in" &&
                (query.category === undefined ||
                  (seed.category ?? "unknown") === query.category)
            )
            .map((seed) =>
              toReply(
                identity,
                seed,
                store.channelOf(seed.campaignId),
                query.includeBody
              )
            ),
          query,
          pageSize
        )
      ),
    listSenders: (query) => {
      const seeds = (data.senders ?? []).filter(
        (sender) =>
          query.campaignId === undefined ||
          (sender.campaignIds ?? []).includes(query.campaignId)
      );

      return Promise.resolve(
        paginate(
          seeds.map((seed) => toSender(identity, seed)),
          query,
          pageSize
        )
      );
    },
    listWorkspaces: () =>
      Promise.resolve({
        items: [
          {
            ...recordBase(identity, identity.workspaceId, null),
            name: identity.workspaceId,
          },
        ],
      }),
    stats: (query) =>
      Promise.resolve(queryStats(identity, data.stats ?? [], query)),
  };
};

type AccountReads = Pick<
  Adapter,
  | "getCampaignSettings"
  | "getSenderHealth"
  | "listBlocklist"
  | "listLists"
  | "listSubsequences"
  | "listTags"
  | "listWebhooks"
>;

const accountReads = (store: Store): AccountReads => {
  const { data, identity, pageSize } = store;

  const page = <Item>(items: readonly Item[], query: PageQuery) =>
    Promise.resolve(paginate(items, query, pageSize));

  return {
    getCampaignSettings: (id) =>
      Promise.resolve(
        toSettings(identity, id, findCampaign(store, id).settings ?? {})
      ),
    getSenderHealth: (id) => {
      const seed = data.senders?.find((sender) => sender.id === id);

      return seed === undefined
        ? Promise.reject(notFound(identity.provider, "Sender", id))
        : Promise.resolve(toHealth(identity, seed, seed.health ?? {}));
    },
    listBlocklist: (query) =>
      page(
        (data.blocklist ?? []).map((seed) => toBlockEntry(identity, seed)),
        query
      ),
    listLists: (query) =>
      page(
        (data.lists ?? []).map((seed) =>
          toList(
            identity,
            seed,
            (data.leads ?? []).filter((lead) =>
              (lead.listIds ?? []).includes(seed.id)
            ).length
          )
        ),
        query
      ),
    listSubsequences: (query) => {
      const campaign = findCampaign(store, query.campaignId);

      return page(
        (campaign.subsequences ?? []).map((seed) =>
          toSubsequence(identity, campaign, seed)
        ),
        query
      );
    },
    listTags: (query) =>
      page(
        (data.tags ?? []).map((seed) => toTag(identity, seed)),
        query
      ),
    listWebhooks: (query) =>
      page(
        (data.webhooks ?? []).flatMap((seed) =>
          query.campaignId === undefined || seed.campaignId === query.campaignId
            ? [toWebhook(identity, seed)]
            : []
        ),
        query
      ),
  };
};

/** An adapter over data held in memory. */
export const memory = (options: MemoryOptions = {}): Adapter => {
  const provider = options.name ?? "memory";

  const identity = {
    provider,
    workspaceId: assertWorkspaceId(options.workspaceId ?? "default", provider),
  };

  const data = options.data ?? {};
  const capabilities = { ...FULL_CAPABILITIES, ...options.capabilities };

  const channels = new Map(
    (data.campaigns ?? []).map((seed) => [seed.id, seed.channel ?? "email"])
  );

  const store: Store = {
    capabilities,
    channelOf: (campaignId) =>
      (campaignId === undefined ? undefined : channels.get(campaignId)) ??
      "email",
    data,
    identity,
    pageSize: options.pageSize ?? 50,
  };

  return {
    ...getters(store),
    ...listers(store),
    ...accountReads(store),
    capabilities,
    costs: {},
    // Nothing is rate limited in memory; the numbers only keep the engine's math defined.
    limits: {
      source: "in-memory adapter, not a vendor limit",
      windows: [{ perMs: 1000, requests: 1_000_000 }],
    },
    mapError: makeErrorMapper(provider),
    maturity: "stable",
    name: provider,
    raw: {
      authorize: (spec) => spec,
      baseUrl: "memory://outbound-sdk",
      // There is no vendor API behind this adapter, so raw has nothing to read.
      isRead: () => false,
    },
    secrets: [],
    workspaceId: identity.workspaceId,
  };
};
