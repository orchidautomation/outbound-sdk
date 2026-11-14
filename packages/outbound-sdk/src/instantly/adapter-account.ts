// The account-level reads: a campaign's settings and subsequences, a
// mailbox's health, lead lists, the block list, tags and webhooks.

import type { Adapter } from "../internal/adapter.ts";
import { emailAddress } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import type { InstantlyClient } from "./client.ts";
import {
  toBlockEntry,
  toCampaignSettings,
  toLeadList,
  toSenderHealth,
  toTag,
  toWebhook,
} from "./map-account.ts";
import { toSubsequence } from "./map.ts";
import { listPage } from "./pages.ts";

type AccountReaders = Pick<
  Adapter,
  | "getCampaignSettings"
  | "getSenderHealth"
  | "listBlocklist"
  | "listLists"
  | "listSubsequences"
  | "listTags"
  | "listWebhooks"
>;

export const accountReaders = (client: InstantlyClient): AccountReaders => {
  const { identity } = client;

  return {
    getCampaignSettings: async (id, ctx) =>
      toCampaignSettings(
        identity,
        await client.getObject(ctx, `/campaigns/${encodeURIComponent(id)}`)
      ),
    getSenderHealth: async (id, ctx) => {
      const account = await client.getObject(
        ctx,
        `/accounts/${encodeURIComponent(id)}`
      );

      const address = emailAddress(account.email) ?? id;

      // Both are POSTs that only read: a DNS test and a report.
      const vitals = await client.post(ctx, "/accounts/test/vitals", {
        accounts: [address],
      });

      const warmup = await client.post(ctx, "/accounts/warmup-analytics", {
        emails: [address],
      });

      return toSenderHealth(identity, id, { account, vitals, warmup });
    },
    listBlocklist: async (query, ctx) => {
      const page = await listPage(client, ctx, "/block-lists-entries", query);

      return mapPage(page, (item) => toBlockEntry(identity, item));
    },
    listLists: async (query, ctx) => {
      const page = await listPage(client, ctx, "/lead-lists", query);

      return mapPage(page, (item) => toLeadList(identity, item));
    },
    listSubsequences: async (query, ctx) => {
      const page = await listPage(client, ctx, "/subsequences", query, {
        parent_campaign: query.campaignId,
      });

      return mapPage(page, (item) =>
        toSubsequence(identity, item, query.campaignId)
      );
    },
    listTags: async (query, ctx) => {
      const page = await listPage(client, ctx, "/custom-tags", query);

      return mapPage(page, (item) => toTag(identity, item));
    },
    listWebhooks: async (query, ctx) => {
      const page = await listPage(client, ctx, "/webhooks", query, {
        campaign: query.campaignId,
      });

      return mapPage(page, (item) => toWebhook(identity, item));
    },
  };
};
