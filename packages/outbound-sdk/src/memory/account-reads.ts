// The in-memory adapter's account-level reads.

import type { Adapter, PageQuery } from "../internal/adapter.ts";
import {
  toBlockEntry,
  toHealth,
  toList,
  toSettings,
  toTag,
  toWebhook,
} from "./account.ts";
import { toSubsequence } from "./data.ts";
import { findCampaign, notFound, paginate } from "./store.ts";
import type { Store } from "./store.ts";

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

export const accountReads = (store: Store): AccountReads => {
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
