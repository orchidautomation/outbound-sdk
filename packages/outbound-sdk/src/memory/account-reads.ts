// The in-memory adapter's account-level reads.

import type { Adapter, PageQuery } from "../internal/adapter.ts";
import type { LeadProgress } from "../internal/entities.ts";
import { recordBase } from "../internal/record.ts";
import { makeRef } from "../internal/ref.ts";
import {
  toBlockEntry,
  toHealth,
  toList,
  toSettings,
  toTag,
  toWebhook,
} from "./account.ts";
import { toLead, toSubsequence } from "./data.ts";
import { findCampaign, notFound, paginate } from "./store.ts";
import type { Store } from "./store.ts";

type AccountReads = Pick<
  Adapter,
  | "getCampaignProgress"
  | "getCampaignSettings"
  | "getList"
  | "getSenderHealth"
  | "getWebhook"
  | "listBlocklist"
  | "listLists"
  | "listSubsequences"
  | "listTags"
  | "listWebhooks"
>;

export const accountReads = (store: Store): AccountReads => {
  const { data, identity, pageSize } = store;

  const page = <Item>(items: readonly Item[], query: PageQuery) =>
    Promise.resolve(paginate(items, query, pageSize));

  // A list's size is the number of seeded leads on it.
  const sizeOf = (listId: string): number =>
    (data.leads ?? []).filter((lead) => (lead.listIds ?? []).includes(listId))
      .length;

  return {
    // Counted from the seeded leads of the campaign, by their progress.
    getCampaignProgress: (id) => {
      findCampaign(store, id);

      const mine = (data.leads ?? []).filter((lead) => lead.campaignId === id);

      const counted = (progress: LeadProgress): number =>
        mine.filter((lead) => toLead(identity, lead).progress === progress)
          .length;

      return Promise.resolve({
        ...recordBase(identity, id, null),
        blocked: null,
        campaignRef: makeRef(identity.provider, identity.workspaceId, id),
        completed: counted("completed"),
        failed: null,
        inProgress: counted("active"),
        leads: mine.length,
        notStarted: null,
        stopped: counted("paused"),
      });
    },
    getCampaignSettings: (id) =>
      Promise.resolve(
        toSettings(identity, id, findCampaign(store, id).settings ?? {})
      ),
    getList: (id) => {
      const seed = data.lists?.find((list) => list.id === id);

      return seed === undefined
        ? Promise.reject(notFound(identity.provider, "List", id))
        : Promise.resolve(toList(identity, seed, sizeOf(seed.id)));
    },
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
    getWebhook: (id) => {
      const seed = data.webhooks?.find((webhook) => webhook.id === id);

      return seed === undefined
        ? Promise.reject(notFound(identity.provider, "Webhook", id))
        : Promise.resolve(toWebhook(identity, seed));
    },
    listLists: (query) =>
      page(
        (data.lists ?? []).map((seed) =>
          toList(identity, seed, sizeOf(seed.id))
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
