// The account-level reads: a campaign's settings and subsequences, a
// mailbox's health, lead lists, the block list, tags and webhooks.

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, emailAddress, field, text } from "../internal/json.ts";
import { flatMapPage, mapPage } from "../internal/page.ts";
import type { InstantlyClient } from "./client.ts";
import {
  toBlockEntry,
  toCampaignProgress,
  toCampaignSettings,
  toLeadList,
  toPlacementTest,
  toSenderHealth,
  toTag,
  toWebhook,
} from "./map-account.ts";
import { toSubsequence } from "./map.ts";
import { listPage } from "./pages.ts";
import { countSkipped } from "./skipped-count.ts";

type AccountReaders = Pick<
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

export const accountReaders = (client: InstantlyClient): AccountReaders => {
  const { identity } = client;

  return {
    // The per-campaign report, asked for one campaign: an array of one row.
    // It has no skipped count, so the leads not contacted are counted too.
    getCampaignProgress: async (id, ctx) => {
      const rows = await client.getRows(ctx, "/campaigns/analytics", {
        query: { id },
      });

      const row = rows.find((each) => text(each.campaign_id) === id) ?? rows[0];

      if (row === undefined) {
        throw new OutboundError("NotFound", `Campaign ${id} was not found`, {
          provider: identity.provider,
        });
      }

      return toCampaignProgress(
        identity,
        id,
        row,
        await countSkipped(client, ctx, id)
      );
    },
    getCampaignSettings: async (id, ctx) =>
      toCampaignSettings(
        identity,
        await client.getObject(ctx, `/campaigns/${encodeURIComponent(id)}`),
        ctx.note
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
    // The list itself carries no count of its leads; its verification
    // statistics do, so a single list costs two requests and has a size.
    getList: async (id, ctx) => {
      const path = `/lead-lists/${encodeURIComponent(id)}`;
      const list = await client.getObject(ctx, path);
      const stats = await client.get(ctx, `${path}/verification-stats`);

      return toLeadList(identity, list, count(field(stats, "total_leads")));
    },
    getWebhook: async (id, ctx) =>
      toWebhook(
        identity,
        await client.getObject(ctx, `/webhooks/${encodeURIComponent(id)}`)
      ),
    listBlocklist: async (query, ctx) => {
      const page = await listPage(client, ctx, "/block-lists-entries", query);

      return flatMapPage(page, (item) => toBlockEntry(identity, item));
    },
    listLists: async (query, ctx) => {
      const page = await listPage(client, ctx, "/lead-lists", query);

      return mapPage(page, (item) => toLeadList(identity, item));
    },
    listPlacementTests: async (query, ctx) => {
      const page = await listPage(client, ctx, "/inbox-placement-tests", query);

      return mapPage(page, (item) => toPlacementTest(identity, item));
    },
    listSubsequences: async (query, ctx) => {
      const page = await listPage(client, ctx, "/subsequences", query, {
        parent_campaign: query.campaignId,
      });

      return mapPage(page, (item) =>
        toSubsequence(identity, item, query.campaignId, ctx.note)
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
