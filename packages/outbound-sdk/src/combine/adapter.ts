// outbound-sdk/combine: several adapters or keys behind one instance.
//
// The combined instance promises only what every member can do, and every
// record keeps its own provider and workspace, so data from two tools or two
// clients can never be confused. It reads every tool live and keeps nothing:
// each call pays each vendor's rate limit, on that vendor's own budget.

import type { Adapter, AdapterContext, Page } from "../internal/adapter.ts";
import {
  intersectCapabilities,
  resolveCapabilities,
} from "../internal/capabilities.ts";
import type { Lead, MetricRow } from "../internal/entities.ts";
import { makeErrorMapper, OutboundError } from "../internal/errors.ts";
import { mergeFields, resolveFields } from "../internal/fields.ts";
import type { Json } from "../internal/json.ts";
import { recordBase } from "../internal/record.ts";
import { accountReads } from "./account.ts";
import { COMBINED, pageAcross, pageTogether, routeRef } from "./route.ts";

const MATURITY_ORDER = ["unverified", "beta", "stable"] as const;

const weakestMaturity = (members: readonly Adapter[]): Adapter["maturity"] =>
  MATURITY_ORDER.find((level) =>
    members.some((member) => member.maturity === level)
  ) ?? "stable";

const assertDistinct = (members: readonly Adapter[]): void => {
  if (members.length === 0) {
    throw new OutboundError("Invalid", "combine() needs at least one adapter", {
      provider: COMBINED,
    });
  }

  const seen = new Set<string>();

  for (const member of members) {
    const key = `${member.name}:${member.workspaceId}`;

    if (member.members !== undefined) {
      throw new OutboundError(
        "Invalid",
        "combine() cannot nest another combined adapter",
        {
          provider: COMBINED,
        }
      );
    }

    if (seen.has(key)) {
      throw new OutboundError(
        "Invalid",
        `Two adapters are both ${key}. Give each one its own workspaceId so their records stay apart`,
        { provider: COMBINED }
      );
    }

    seen.add(key);
  }
};

const missing = (member: Adapter, method: string): OutboundError =>
  new OutboundError(
    "Unsupported",
    `The ${member.name} adapter does not implement ${method}`,
    {
      provider: member.name,
    }
  );

type Lists = Pick<
  Adapter,
  | "listCampaigns"
  | "listLeads"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "listWorkspaces"
>;

const scopedOrAcross = <
  Item,
  Query extends {
    readonly campaignId?: string | undefined;
    readonly next?: Json | undefined;
  },
>(
  members: readonly Adapter[],
  ctx: AdapterContext,
  query: Query,
  read: (
    member: Adapter,
    memberCtx: AdapterContext,
    query: Query
  ) => Promise<Page<Item>>
): Promise<Page<Item>> => {
  if (query.campaignId === undefined) {
    return pageAcross(members, ctx, query, (member, memberCtx, next) =>
      read(member, memberCtx, { ...query, next })
    );
  }

  // A campaign lives in exactly one member, so the listing goes straight there.
  const routed = routeRef(members, ctx, query.campaignId, "Campaign");

  return read(routed.member, routed.ctx, { ...query, campaignId: routed.id });
};

const lists = (members: readonly Adapter[]): Lists => ({
  listCampaigns: (query, ctx) => {
    if (query.senderId !== undefined) {
      // A sender lives in exactly one member, and so do its campaigns.
      const routed = routeRef(members, ctx, query.senderId, "Sender");

      return routed.member.listCampaigns(
        { ...query, senderId: routed.id },
        routed.ctx
      );
    }

    return pageAcross(members, ctx, query, (member, memberCtx, next) =>
      member.listCampaigns({ ...query, next }, memberCtx)
    );
  },
  listLeads: (query, ctx) => {
    if (query.listId !== undefined) {
      // A saved list lives in exactly one member.
      const routed = routeRef(members, ctx, query.listId, "List");

      if (routed.member.listLeads === undefined) {
        throw missing(routed.member, "listLeads");
      }

      return routed.member.listLeads(
        { ...query, listId: routed.id },
        routed.ctx
      );
    }

    const readLeads = (
      member: Adapter,
      memberCtx: AdapterContext,
      scoped: typeof query
    ): Promise<Page<Lead>> => {
      if (member.listLeads === undefined) {
        throw missing(member, "listLeads");
      }

      return member.listLeads(scoped, memberCtx);
    };

    const lookup =
      query.email !== undefined ||
      query.linkedinUrl !== undefined ||
      query.domain !== undefined;

    // A person or domain lookup returns a few records from each tool, so
    // every tool is asked at once instead of one after another.
    if (lookup && query.campaignId === undefined) {
      return pageTogether(
        members,
        ctx,
        query,
        async (member, memberCtx, next) =>
          await readLeads(member, memberCtx, { ...query, next })
      );
    }

    return scopedOrAcross(members, ctx, query, readLeads);
  },
  listMessages: (query, ctx) => {
    const lead =
      query.leadId === undefined
        ? undefined
        : routeRef(members, ctx, query.leadId, "Lead");

    return scopedOrAcross(
      lead === undefined ? members : [lead.member],
      ctx,
      query,
      (member, memberCtx, scoped) => {
        if (member.listMessages === undefined) {
          throw missing(member, "listMessages");
        }

        return member.listMessages({ ...scoped, leadId: lead?.id }, memberCtx);
      }
    );
  },
  listReplies: (query, ctx) =>
    scopedOrAcross(members, ctx, query, (member, memberCtx, scoped) => {
      if (member.listReplies === undefined) {
        throw missing(member, "listReplies");
      }

      return member.listReplies(scoped, memberCtx);
    }),
  listSenders: (query, ctx) =>
    scopedOrAcross(members, ctx, query, (member, memberCtx, scoped) => {
      if (member.listSenders === undefined) {
        throw missing(member, "listSenders");
      }

      return member.listSenders(scoped, memberCtx);
    }),
  // One workspace per member, named by its label. No request is made.
  listWorkspaces: () =>
    Promise.resolve({
      items: members.map((member) => ({
        ...recordBase(
          { provider: member.name, workspaceId: member.workspaceId },
          member.workspaceId,
          null
        ),
        name: member.workspaceId,
      })),
    }),
});

type Lookups = Pick<
  Adapter,
  "getCampaign" | "getLead" | "getSender" | "getSequence" | "stats"
>;

const lookups = (members: readonly Adapter[]): Lookups => ({
  getCampaign: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Campaign");

    return routed.member.getCampaign(routed.id, routed.ctx);
  },
  getLead: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Lead");

    if (routed.member.getLead === undefined) {
      throw missing(routed.member, "getLead");
    }

    return routed.member.getLead(routed.id, routed.ctx);
  },
  getSender: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Sender");

    if (routed.member.getSender === undefined) {
      throw missing(routed.member, "getSender");
    }

    return routed.member.getSender(routed.id, routed.ctx);
  },
  getSequence: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Campaign");

    if (routed.member.getSequence === undefined) {
      throw missing(routed.member, "getSequence");
    }

    return routed.member.getSequence(routed.id, routed.ctx);
  },
  stats: async (query, ctx): Promise<readonly MetricRow[]> => {
    if (query.scopeId !== undefined) {
      const routed = routeRef(members, ctx, query.scopeId, "Stats scope");

      if (routed.member.stats === undefined) {
        throw missing(routed.member, "stats");
      }

      return await routed.member.stats(
        { ...query, scopeId: routed.id },
        routed.ctx
      );
    }

    // Workspace scope: each member answers for itself. Rows are returned side
    // by side, never added together, because they are different workspaces.
    const perMember = await Promise.all(
      members.map((member) => {
        if (member.stats === undefined) {
          throw missing(member, "stats");
        }

        return member.stats(query, ctx.forAdapter(member));
      })
    );

    return perMember.flat();
  },
});

/**
 * Puts several adapters behind one instance.
 *
 * ```ts
 * createOutbound({ adapter: combine([instantly(), heyreach()]) });
 * ```
 */
export const combine = (members: readonly Adapter[]): Adapter => {
  assertDistinct(members);

  const [first, ...rest] = members.map((member) =>
    resolveCapabilities(member.capabilities)
  );

  return {
    ...lists(members),
    ...lookups(members),
    ...accountReads(members),
    capabilities: {
      ...intersectCapabilities(first ?? resolveCapabilities(), ...rest),
      // A thread id is the vendor's own and names no member, so it cannot be routed.
      "messages.byThread": false,
      // A native read belongs to one vendor; reach it through workspace(id).
      native: false,
      // A combined instance always knows its workspaces: they are its members.
      workspaces: true,
    },
    fieldCoverage: mergeFields(
      members.map(
        (member) => member.fieldCoverage ?? resolveFields(member.fields)
      )
    ),
    caveats: members.flatMap((member) =>
      (member.caveats ?? []).map(
        (caveat) => `${member.name} (${member.workspaceId}): ${caveat}`
      )
    ),
    events: {
      detect: (request) =>
        members.some((member) => member.events?.detect(request) ?? false),
      // The member whose format matches parses it, under its own workspace.
      parse: (request) => {
        const owner = members.find(
          (member) => member.events?.detect(request) ?? false
        );

        return owner?.events?.parse(request, owner.workspaceId) ?? [];
      },
    },
    // The combined adapter never sends a request itself; each member has its own budget.
    limits: {
      source: "combined instance: see each member's limits",
      windows: [],
    },
    mapError: makeErrorMapper(COMBINED, {
      secrets: members.flatMap((member) => member.secrets),
    }),
    maturity: weakestMaturity(members),
    members,
    name: COMBINED,
    raw: {
      authorize: (spec) => spec,
      baseUrl: "combined://",
      isRead: () => false,
    },
    // One client on two tools carries one label on both members, so scoping
    // to the label keeps both. A label on one member is that member itself.
    scope: (workspaceId) => {
      // `provider:workspace` names one member, for what only one vendor can
      // answer: its native reads, its raw client, its threads.
      const labelled = members.filter(
        (member) =>
          member.workspaceId === workspaceId ||
          `${member.name}:${member.workspaceId}` === workspaceId
      );

      return labelled.length > 1 ? combine(labelled) : labelled[0];
    },
    secrets: members.flatMap((member) => member.secrets),
    workspaceId: COMBINED,
  };
};
