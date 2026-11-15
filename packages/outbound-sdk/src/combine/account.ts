// The account-level reads of a combined instance. A lookup goes to the member
// its ref names; a listing walks every member in turn.

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { pageAcross, routeRef } from "./route.ts";

type AccountReads = Pick<
  Adapter,
  | "getCampaignProgress"
  | "getCampaignSettings"
  | "getList"
  | "getSenderHealth"
  | "getWebhook"
  | "listBlocklist"
  | "listLists"
  | "listPlacementTests"
  | "listSubsequences"
  | "listTags"
  | "listWebhooks"
>;

const missing = (member: Adapter, method: string): OutboundError =>
  new OutboundError(
    "Unsupported",
    `The ${member.name} adapter does not implement ${method}`,
    { provider: member.name }
  );

/** The method, or `Unsupported` naming the member that lacks it. */
const need = <Key extends keyof AccountReads>(
  member: Adapter,
  method: Key
): NonNullable<Adapter[Key]> => {
  const found = member[method];

  if (found === undefined) {
    throw missing(member, method);
  }

  return found;
};

export const accountReads = (members: readonly Adapter[]): AccountReads => ({
  getCampaignProgress: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Campaign");

    return need(routed.member, "getCampaignProgress")(routed.id, routed.ctx);
  },
  getCampaignSettings: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Campaign");

    return need(routed.member, "getCampaignSettings")(routed.id, routed.ctx);
  },
  getList: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "List");

    return need(routed.member, "getList")(routed.id, routed.ctx);
  },
  getSenderHealth: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Sender");

    return need(routed.member, "getSenderHealth")(routed.id, routed.ctx);
  },
  getWebhook: (id, ctx) => {
    const routed = routeRef(members, ctx, id, "Webhook");

    return need(routed.member, "getWebhook")(routed.id, routed.ctx);
  },
  listBlocklist: (query, ctx) =>
    pageAcross(members, ctx, query, (member, memberCtx, next) =>
      need(member, "listBlocklist")({ ...query, next }, memberCtx)
    ),
  listLists: (query, ctx) =>
    pageAcross(members, ctx, query, (member, memberCtx, next) =>
      need(member, "listLists")({ ...query, next }, memberCtx)
    ),
  listPlacementTests: (query, ctx) =>
    pageAcross(members, ctx, query, (member, memberCtx, next) =>
      need(member, "listPlacementTests")({ ...query, next }, memberCtx)
    ),
  listSubsequences: (query, ctx) => {
    const routed = routeRef(members, ctx, query.campaignId, "Campaign");

    return need(routed.member, "listSubsequences")(
      { ...query, campaignId: routed.id },
      routed.ctx
    );
  },
  listTags: (query, ctx) =>
    pageAcross(members, ctx, query, (member, memberCtx, next) =>
      need(member, "listTags")({ ...query, next }, memberCtx)
    ),
  listWebhooks: (query, ctx) => {
    if (query.campaignId === undefined) {
      return pageAcross(members, ctx, query, (member, memberCtx, next) =>
        need(member, "listWebhooks")({ ...query, next }, memberCtx)
      );
    }

    const routed = routeRef(members, ctx, query.campaignId, "Campaign");

    return need(routed.member, "listWebhooks")(
      { ...query, campaignId: routed.id },
      routed.ctx
    );
  },
});
