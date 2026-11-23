// A complete adapter backed by data in memory. It tests the core without a
// network and powers demos.

import type {
  Adapter,
  CampaignQuery,
  LeadQuery,
  TimeRange,
} from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { Lead } from "../internal/entities.ts";
import { makeErrorMapper } from "../internal/errors.ts";
import type { FieldDeclaration } from "../internal/fields.ts";
import { recordBase } from "../internal/record.ts";
import { assertWorkspaceId } from "../internal/ref.ts";
import { profileSlug } from "../internal/url.ts";
import { accountReads } from "./account-reads.ts";
import {
  toCampaign,
  toLead,
  toMessage,
  toReply,
  toSender,
  toSequence,
} from "./data.ts";
import type {
  MemoryCampaign,
  MemoryData,
  MemoryLead,
  MemoryMessage,
} from "./data.ts";
import { queryStats } from "./stats.ts";
import { findCampaign, notFound, paginate } from "./store.ts";
import type { Store } from "./store.ts";

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
  /**
   * The fields this adapter says it never fills, as a vendor adapter declares
   * them, for example `{ campaign: { tags: false } }` to act like a tool whose
   * campaigns have no tags. Defaults to every field filled.
   */
  readonly fields?: FieldDeclaration | undefined;
}

const FULL_CAPABILITIES: CapabilityDeclaration = {
  blocklist: true,
  "campaigns.byName": "client",
  "campaigns.bySender": true,
  "campaigns.byTag": "client",
  "campaigns.progress": true,
  "campaigns.settings": true,
  "campaigns.status": "server",
  "leads.byCampaign": true,
  "leads.byDomain": true,
  "leads.byStatus": true,
  "leads.engagement": true,
  "leads.get": true,
  "leads.list": true,
  "leads.lookup": true,
  "leads.since": "server",
  "leads.timeline": true,
  "lists.get": true,
  "lists.leads": true,
  "lists.list": true,
  "messages.body": "full",
  "messages.byThread": true,
  "messages.list": true,
  "messages.byCampaign": "server",
  "messages.since": "server",
  "placementTests.list": true,
  "replies.byCampaign": "server",
  "replies.category": "vendor",
  "replies.list": true,
  "replies.since": "server",
  "replies.unread": "server",
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
  "stats.allCampaigns": "full",
  "stats.campaign": "exact",
  "stats.workspace": "exact",
  tags: true,
  "webhooks.get": true,
  "webhooks.list": true,
  workspaces: true,
};

const within = (time: string | undefined, range: TimeRange): boolean =>
  time === undefined
    ? range.since === undefined && range.until === undefined
    : (range.since === undefined || time >= range.since) &&
      (range.until === undefined || time <= range.until);

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

/** The latest message of each conversation that holds a reply. */
const latestOfReplied = (
  messages: readonly MemoryMessage[]
): MemoryMessage[] => {
  const latest = new Map<string, MemoryMessage>();
  const replied = new Set<string>();

  for (const message of messages) {
    const thread = message.threadId ?? message.id;
    const kept = latest.get(thread);

    if (message.direction === "in") {
      replied.add(thread);
    }

    if (kept === undefined || message.sentAt > kept.sentAt) {
      latest.set(thread, message);
    }
  }

  return [...latest].flatMap(([thread, message]) =>
    replied.has(thread) ? [message] : []
  );
};

const selectLeads = (store: Store, query: LeadQuery): MemoryLead[] =>
  (store.data.leads ?? []).filter(
    (lead) =>
      (query.campaignId === undefined ||
        lead.campaignId === query.campaignId) &&
      (query.listId === undefined ||
        (lead.listIds ?? []).includes(query.listId)) &&
      (query.email === undefined ||
        lead.email?.trim().toLowerCase() === query.email) &&
      (query.emails === undefined ||
        query.emails.includes(lead.email?.trim().toLowerCase() ?? "")) &&
      (query.domain === undefined ||
        lead.email?.trim().toLowerCase().split("@").at(-1) === query.domain) &&
      (query.linkedinUrl === undefined ||
        (profileSlug(lead.linkedinUrl) !== null &&
          profileSlug(lead.linkedinUrl) === profileSlug(query.linkedinUrl))) &&
      (!filtersByTime(store, "leads.since") || within(lead.createdAt, query))
  );

/** The leads that meet the query, `status` included, which is known only once a seed is read as a lead. */
const selectedLeads = (store: Store, query: LeadQuery): Lead[] =>
  selectLeads(store, query)
    .map((seed) => toLead(store.identity, seed))
    .filter(
      (lead) =>
        (query.status === undefined || lead.status === query.status) &&
        (query.interest === undefined ||
          lead.interestCategory === query.interest)
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

// The campaigns a query asks for: one sender's, and one status when this
// adapter is set to filter by status itself.
const selectCampaigns = (
  store: Store,
  query: CampaignQuery
): readonly MemoryCampaign[] => {
  const { data } = store;
  const filterHere = store.capabilities["campaigns.status"] === "server";

  const attached =
    query.senderId === undefined
      ? undefined
      : (data.senders ?? []).find((sender) => sender.id === query.senderId)
          ?.campaignIds;

  return (data.campaigns ?? []).filter(
    (campaign) =>
      (query.senderId === undefined ||
        (attached ?? []).includes(campaign.id)) &&
      (!filterHere ||
        query.status === undefined ||
        (campaign.status ?? "active") === query.status)
  );
};

const listers = (store: Store): Listers => {
  const { data, identity, pageSize } = store;

  return {
    listCampaigns: (query) =>
      Promise.resolve(
        paginate(
          selectCampaigns(store, query).map((seed) =>
            toCampaign(identity, seed)
          ),
          query,
          pageSize
        )
      ),
    listLeads: (query) =>
      Promise.resolve(paginate(selectedLeads(store, query), query, pageSize)),
    listMessages: (query) => {
      const selected = selectMessages(store, query, "messages.since").filter(
        (seed) =>
          query.byHand === undefined ||
          (seed.direction === "out" && seed.byHand === true)
      );

      return Promise.resolve(
        paginate(
          (query.latestOfConversation === true
            ? latestOfReplied(selected)
            : selected
          ).map((seed) =>
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
      );
    },
    listReplies: (query) =>
      Promise.resolve(
        paginate(
          selectMessages(store, query, "replies.since")
            .filter(
              (seed) =>
                seed.direction === "in" &&
                (query.unread === undefined || seed.unread === query.unread) &&
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
    stats: (query) => {
      const ofCampaign =
        query.scopeId !== undefined &&
        (query.scope === "campaign" || query.scope === "step");

      // A campaign nothing in the data mentions has no stats to be empty: it is not found.
      return ofCampaign && !store.mentionsCampaign(query.scopeId)
        ? Promise.reject(
            notFound(identity.provider, "Campaign", query.scopeId ?? "")
          )
        : Promise.resolve(queryStats(identity, data.stats ?? [], query));
    },
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

  // Seeds are short: a campaign can exist only as the id its stats, leads or messages name.
  const mentioned = new Set<string | undefined>([
    ...channels.keys(),
    ...(data.stats ?? []).map((seed) => seed.campaignId),
    ...(data.leads ?? []).map((seed) => seed.campaignId),
    ...(data.messages ?? []).map((seed) => seed.campaignId),
    ...(data.senders ?? []).flatMap((seed) => seed.campaignIds ?? []),
  ]);

  const store: Store = {
    capabilities,
    channelOf: (campaignId) =>
      (campaignId === undefined ? undefined : channels.get(campaignId)) ??
      "email",
    data,
    identity,
    mentionsCampaign: (campaignId) =>
      campaignId !== undefined && mentioned.has(campaignId),
    pageSize: options.pageSize ?? 50,
  };

  return {
    ...getters(store),
    ...listers(store),
    ...accountReads(store),
    capabilities,
    costs: {},
    fields: options.fields,
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
