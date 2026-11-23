// An instance that reads only what a campaign scope covers, which an
// insight runs on in place of the whole workspace. The scope's campaigns
// are found first (scope-campaigns.ts). A per-campaign read of a campaign
// outside them is refused, and a read that would span the workspace, such
// as every reply or the workspace's stats, is made once per campaign of the
// scope instead, so another client's records are never read.

import type { Campaign, Sender } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type {
  CampaignFilters,
  CampaignHandle,
  ListAll,
  ListAllOptions,
  OutboundApi,
  ReadCollection,
  StatsResult,
  TopLevelStatsOptions,
} from "../internal/outbound/api.ts";
import { outsideScope, scopeCampaigns } from "./scope-campaigns.ts";
import type { ScopeReads } from "./scope-campaigns.ts";
import { after, FanWalk, kept, listOf } from "./scope-walks.ts";
import { admits, namesId } from "./scope.ts";
import type { CampaignScope } from "./scope.ts";

export type { ScopeReads } from "./scope-campaigns.ts";

interface State {
  readonly outbound: OutboundApi;
  readonly scope: CampaignScope;
  readonly reads: ScopeReads;
  /** The scope's campaigns, every state, read once. */
  readonly campaigns: () => Promise<Campaign[]>;
  /** Refuses a campaign outside the scope, reading it only when its tag or name decides. */
  readonly admit: (id: string) => Promise<void>;
  /** Whether a record of this campaign is in scope. Valid once `campaigns()` resolved. */
  readonly knows: (campaignRef: string | null) => boolean;
}

const stateOf = (
  outbound: OutboundApi,
  scope: CampaignScope,
  reads: ScopeReads
): State => {
  let listed: Promise<Campaign[]> | undefined;
  const known = new Set<string>();
  const checked = new Map<string, Promise<void>>();

  const campaigns = (): Promise<Campaign[]> => {
    listed ??= scopeCampaigns(outbound, scope, reads).then((found) => {
      for (const campaign of found) {
        known.add(campaign.ref);
        known.add(campaign.sourceId);
      }

      return found;
    });

    return listed;
  };

  const check = async (id: string): Promise<void> => {
    if (known.has(id)) {
      return;
    }

    const refused = outsideScope(reads, scope, id, outbound.provider);

    // Once the scope's campaigns are known, they decide.
    if (listed !== undefined) {
      await listed;

      if (known.has(id)) {
        return;
      }

      throw refused;
    }

    if (!namesId(scope, id)) {
      throw refused;
    }

    if (scope.tag === undefined && scope.name === undefined) {
      return;
    }

    if (!admits(scope, reads.one(await outbound.campaigns.get(id)))) {
      throw refused;
    }
  };

  const admit = (id: string): Promise<void> => {
    const pending = checked.get(id) ?? check(id);
    checked.set(id, pending);

    return pending;
  };

  const knows = (campaignRef: string | null): boolean =>
    campaignRef !== null && known.has(campaignRef);

  return { admit, campaigns, knows, outbound, reads, scope };
};

/** A collection of one campaign whose every read waits for the campaign to be admitted. */
const guarded = <Item, Filters>(
  collection: ReadCollection<Item, Filters>,
  ready: () => Promise<void>
): ReadCollection<Item, Filters> => ({
  list: async (options) => {
    await ready();

    return await collection.list(options);
  },
  listAll: (options) => after(ready, () => collection.listAll(options)),
});

const guardedHandle = (state: State, id: string): CampaignHandle => {
  const handle = state.outbound.campaign(id);
  const ready = () => state.admit(id);

  const call =
    <Args extends unknown[], Result>(
      read: (...args: Args) => Promise<Result>
    ) =>
    async (...args: Args): Promise<Result> => {
      await ready();

      return await read(...args);
    };

  return {
    ...handle,
    get: call(handle.get),
    leads: guarded(handle.leads, ready),
    messages: guarded(handle.messages, ready),
    progress: call(handle.progress),
    replies: guarded(handle.replies, ready),
    senders: guarded(handle.senders, ready),
    sequence: call(handle.sequence),
    settings: call(handle.settings),
    stats: call(handle.stats),
    subsequences: guarded(handle.subsequences, ready),
    webhooks: guarded(handle.webhooks, ready),
  };
};

const lower = (text: string | undefined) => text?.toLowerCase();

/** The scope's campaigns that a listing with these filters would return. */
const campaignsListed = (
  state: State,
  options: (CampaignFilters & ListAllOptions) | undefined
): ListAll<Campaign> => {
  // A sender's campaigns are listed as they are, then kept if in scope.
  if (options?.senderId !== undefined) {
    return kept(state.outbound.campaigns.listAll(options), (campaign) =>
      admits(state.scope, campaign)
    );
  }

  const name = lower(options?.name);
  const tag = lower(options?.tag);

  return listOf(async () => {
    const found = await state.campaigns();

    return found.filter(
      (campaign) =>
        (options?.status === undefined || campaign.status === options.status) &&
        (name === undefined ||
          (campaign.name ?? "").toLowerCase().includes(name)) &&
        (tag === undefined || campaign.tags.some((each) => lower(each) === tag))
    );
  }, options?.max);
};

/** One listing made of the same listing on each campaign of the scope, `max` in all. */
const perCampaign = <Item>(
  state: State,
  open: (campaign: CampaignHandle, room: number | undefined) => ListAll<Item>,
  max: number | undefined,
  keyOf?: (item: Item) => string
): ListAll<Item> =>
  new FanWalk<Campaign, Item>({
    keyOf,
    max,
    sources: () => state.campaigns(),
    walkOf: (campaign, room) =>
      open(state.outbound.campaign(campaign.ref), room),
  });

const pageRefused = (state: State, what: string): OutboundError =>
  new OutboundError(
    "Unsupported",
    `${state.reads.insight}: under a campaign scope ${what} are read with listAll, one campaign at a time`,
    { provider: state.outbound.provider }
  );

/**
 * A workspace collection with a `campaignId` filter: given one, the campaign
 * must be in scope; without one, the listing is made per campaign.
 */
const perCampaignCollection = <
  Item,
  Filters extends { readonly campaignId?: string | undefined },
>(
  state: State,
  collection: ReadCollection<Item, Filters>,
  what: string,
  ofCampaign: (
    handle: CampaignHandle
  ) => ReadCollection<Item, Omit<Filters, "campaignId">>,
  keyOf?: (item: Item) => string
): ReadCollection<Item, Filters> => ({
  list: async (options) => {
    if (options?.campaignId === undefined) {
      throw pageRefused(state, what);
    }

    await state.admit(options.campaignId);

    return await collection.list(options);
  },
  listAll: (options) => {
    const campaignId = options?.campaignId;

    if (campaignId !== undefined) {
      return after(
        () => state.admit(campaignId),
        () => collection.listAll(options)
      );
    }

    const { campaignId: _none, max, ...rest } = options ?? {};
    // SAFETY: with `campaignId` taken out, the rest are the campaign's own filters and walk options.
    const own = rest as Omit<Filters, "campaignId"> & ListAllOptions;

    return perCampaign(
      state,
      (handle, room) => ofCampaign(handle).listAll({ ...own, max: room }),
      max,
      keyOf
    );
  },
});

const PERSON_KEYS = [
  "email",
  "emails",
  "linkedinUrl",
  "domain",
  "listId",
] as const;

/**
 * Leads: a person's records found across the workspace (by address, profile,
 * domain or saved list) are kept only where their campaign is in scope,
 * and every other listing is made per campaign.
 */
const scopedLeads = (state: State): OutboundApi["leads"] => {
  const { leads } = state.outbound;

  const byCampaign = perCampaignCollection(
    state,
    leads,
    "leads",
    (handle) => handle.leads
  );

  return {
    ...leads,
    list: byCampaign.list,
    listAll: (options) => {
      if (!PERSON_KEYS.some((key) => options?.[key] !== undefined)) {
        return byCampaign.listAll(options);
      }

      state.reads.note(
        "A person's records are found across the workspace, so those outside the campaign scope were read and left out."
      );

      return after(
        async () => {
          await state.campaigns();
        },
        () =>
          kept(leads.listAll(options), (lead) => state.knows(lead.campaignRef))
      );
    },
  };
};

/** The senders of the scope's campaigns, each once. */
const scopeSenders = (state: State, max?: number): ListAll<Sender> =>
  perCampaign(
    state,
    (handle, room) => handle.senders.listAll({ max: room }),
    max,
    (sender) => sender.ref
  );

/**
 * Stats: the workspace's rows become the rows of each campaign of the
 * scope, which every reader adds up by day. A sender scope with no ids
 * reads the senders of the scope's campaigns.
 */
const scopedStats =
  (state: State) =>
  async (options?: TopLevelStatsOptions): Promise<StatsResult> => {
    const { outbound } = state;
    const scope = options?.scope;

    if (scope === "sender") {
      if (options?.scopeId !== undefined || options?.scopeIds !== undefined) {
        return await outbound.stats(options);
      }

      const senders = await state.reads.all(scopeSenders(state));

      return await outbound.stats({
        ...options,
        scopeIds: senders.map((sender) => sender.ref),
      });
    }

    if (
      scope !== undefined &&
      scope !== "workspace" &&
      options?.scopeId !== undefined
    ) {
      await state.admit(options.scopeId);

      return await outbound.stats(options);
    }

    const range = { by: options?.by, from: options?.from, to: options?.to };
    const results: StatsResult[] = [];

    for (const campaign of await state.campaigns()) {
      // oxlint-disable-next-line no-await-in-loop -- one campaign after another under the run's cap
      results.push(await outbound.campaign(campaign.ref).stats(range));
    }

    state.reads.note(
      "Under a campaign scope the workspace's stats are the scope's campaigns added up, so a lead in two of them counts in both."
    );

    const metas = results.map((result) => result.meta);
    const [first] = metas;

    return {
      meta: {
        complete: metas.every((meta) => meta.complete),
        evidence: "derived",
        fetchedAt: first?.fetchedAt ?? new Date(state.reads.now).toISOString(),
        notes: [...new Set(metas.flatMap((meta) => meta.notes))],
        provider: outbound.provider,
        requests: metas.reduce((sum, meta) => sum + meta.requests, 0),
        stale: metas.some((meta) => meta.stale),
        throttledMs: metas.reduce((sum, meta) => sum + meta.throttledMs, 0),
        workspaceId: outbound.workspaceId,
      },
      rows: results.flatMap((result) => result.rows),
    };
  };

const READS = "replies";

/** Every reply of the scope's campaigns. Conversations outside every campaign are in no scope. */
const scopedReplies = (state: State): OutboundApi["replies"] => {
  const { replies } = state.outbound;

  const byCampaign = perCampaignCollection(
    state,
    replies,
    READS,
    (handle) => handle.replies
  );

  return {
    list: byCampaign.list,
    listAll: (options) => {
      if (options?.includeInbox === true && options.campaignId === undefined) {
        state.reads.note(
          "Replies outside every campaign belong to no campaign scope, so they were not read."
        );
      }

      const { includeInbox: _inbox, ...rest } = options ?? {};

      return byCampaign.listAll(rest);
    },
  };
};

/** The sender records of the scope: a listing per campaign, each sender once. */
const scopedSenders = (state: State): OutboundApi["senders"] => {
  const { senders } = state.outbound;

  const byCampaign = perCampaignCollection(
    state,
    senders,
    "senders",
    (handle) => handle.senders,
    (sender) => sender.ref
  );

  return { ...senders, list: byCampaign.list, listAll: byCampaign.listAll };
};

/**
 * `outbound` with `overrides` in place of its own members. An instance is a
 * class whose getters and methods read private state, so the rest is read
 * from the instance itself, methods bound to it, and its plugins' members
 * and symbols stay reachable.
 */
const overlay = (
  outbound: OutboundApi,
  overrides: Partial<OutboundApi>
): OutboundApi =>
  new Proxy(outbound, {
    get: (target, key) => {
      if (Object.hasOwn(overrides, key)) {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- a proxy's get trap reads whichever member it is asked for, by any key
        return Reflect.get(overrides, key);
      }

      // oxlint-disable-next-line anti-slop/no-reflect-get -- a proxy's get trap reads whichever member it is asked for, by any key
      const value: unknown = Reflect.get(target, key, target);

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a method is bound to the instance so its private state stays reachable
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

/**
 * Reads only what `scope` covers. Insights run on this in place of the
 * instance: `senders.healthList`, `stats.workspace` and `stats.allCampaigns`
 * read as unsupported here, so they take their per-sender and per-campaign
 * paths and never list every sender's health or every campaign's stats.
 */
export const scopedOutbound = (
  outbound: OutboundApi,
  scope: CampaignScope,
  reads: ScopeReads
): OutboundApi => {
  const state = stateOf(outbound, scope, reads);
  const members = new Map<string, OutboundApi>();

  return overlay(outbound, {
    campaign: (id) => guardedHandle(state, id),
    campaigns: {
      ...outbound.campaigns,
      get: async (id, options) => {
        await state.admit(id);

        return await outbound.campaigns.get(id, options);
      },
      list: async (options) => {
        const items = await campaignsListed(state, options).toArray();

        return {
          complete: true,
          cursor: undefined,
          items,
          meta: {
            complete: true,
            evidence: "derived",
            fetchedAt: new Date(reads.now).toISOString(),
            notes: [],
            provider: outbound.provider,
            requests: 0,
            stale: false,
            throttledMs: 0,
            workspaceId: outbound.workspaceId,
          },
        };
      },
      listAll: (options) => campaignsListed(state, options),
    },
    capabilities: {
      ...outbound.capabilities,
      "senders.healthList": false,
      "stats.allCampaigns": false,
      "stats.workspace": false,
    },
    leads: scopedLeads(state),
    messages: perCampaignCollection(
      state,
      outbound.messages,
      "messages",
      (handle) => handle.messages
    ),
    replies: scopedReplies(state),
    sender: (id) => {
      const handle = outbound.sender(id);

      return {
        ...handle,
        campaigns: {
          list: async (options) => {
            const page = await handle.campaigns.list(options);

            return {
              ...page,
              items: page.items.filter((campaign) => admits(scope, campaign)),
            };
          },
          listAll: (options) =>
            kept(handle.campaigns.listAll(options), (campaign) =>
              admits(scope, campaign)
            ),
        },
      };
    },
    senderHealth: {
      list: () => Promise.reject(pageRefused(state, "sender health records")),
      listAll: () => {
        throw pageRefused(state, "sender health records");
      },
    },
    senders: scopedSenders(state),
    stats: scopedStats(state),
    workspace: (id) => {
      const member =
        members.get(id) ?? scopedOutbound(outbound.workspace(id), scope, reads);

      members.set(id, member);

      return member;
    },
  });
};
