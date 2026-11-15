// The account-level reads: a campaign's settings and subsequences, a
// mailbox's health, lead lists, the block list, tags and webhooks.

import type {
  Adapter,
  AdapterContext,
  Page,
  SubsequenceQuery,
  WebhookQuery,
} from "../internal/adapter.ts";
import type { WebhookSubscription } from "../internal/entities-account.ts";
import type { Sequence } from "../internal/entities.ts";
import { count, field, isJsonObject, objects, text } from "../internal/json.ts";
import { flatMapPage, mapPage } from "../internal/page.ts";
import { BLOCKLIST_PAGE_SIZE } from "./capabilities.ts";
import type { SmartleadClient } from "./client.ts";
import {
  toBlockEntry,
  toCampaignProgress,
  toHealth,
  toList,
  toPlacementTest,
  toSettings,
  toTag,
  toWebhook,
} from "./map-account.ts";
import { toSubsequence, unwrap } from "./map.ts";
import {
  campaignIds,
  campaignList,
  idList,
  objectOf,
  offsetPage,
  pageSize,
  rowsOf,
  segment,
} from "./shared.ts";

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

// A subsequence is a child campaign: a row of the campaign list whose
// parent_campaign_id is the campaign. One page is one subsequence, because
// its steps need their own request; the cursor carries the rows still to read.
const listSubsequences = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: SubsequenceQuery
): Promise<Page<Sequence>> => {
  const campaigns = isJsonObject(query.next)
    ? objects(query.next.subsequences)
    : await campaignList(client, ctx);

  // Rows from a cursor are children already; the filter keeps them.
  const children = campaigns.filter(
    (campaign) => text(campaign.parent_campaign_id) === query.campaignId
  );

  const [current, ...rest] = children;
  const id = text(current?.id);

  if (current === undefined || id === null) {
    return { items: [] };
  }

  const steps = await client.get(ctx, `/campaigns/${segment(id)}/sequences`);

  return {
    items: [toSubsequence(client.identity, query.campaignId, current, steps)],
    next: rest.length > 0 ? { subsequences: rest } : undefined,
  };
};

const campaignWebhooks = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  campaignId: string
): Promise<WebhookSubscription[]> =>
  rowsOf(
    client,
    await client.get(ctx, `/campaigns/${segment(campaignId)}/webhooks`),
    `/campaigns/${campaignId}/webhooks`
  ).map((webhook) => toWebhook(client.identity, campaignId, webhook));

// Smartlead lists webhooks per campaign only, so a listing without a campaign
// walks the campaigns. The cursor carries the campaigns still to read and the
// webhook ids already returned, so one shared by several campaigns comes once.
const listWebhooks = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: WebhookQuery
): Promise<Page<WebhookSubscription>> => {
  if (query.campaignId !== undefined) {
    return { items: await campaignWebhooks(client, ctx, query.campaignId) };
  }

  const campaigns = isJsonObject(query.next)
    ? idList(query.next.campaigns)
    : await campaignIds(client, ctx);

  const [current, ...rest] = campaigns;

  if (current === undefined) {
    return { items: [] };
  }

  const seen = new Set(idList(field(query.next, "seen")));

  const listed = await campaignWebhooks(client, ctx, current);
  const items = listed.filter((webhook) => !seen.has(webhook.sourceId));

  return {
    items,
    next:
      rest.length > 0
        ? {
            campaigns: rest,
            seen: [...seen, ...items.map((webhook) => webhook.sourceId)],
          }
        : undefined,
  };
};

export const accountReaders = (client: SmartleadClient): AccountReaders => {
  const { identity } = client;

  return {
    getCampaignProgress: async (id, ctx) =>
      toCampaignProgress(
        identity,
        id,
        objectOf(
          client,
          await client.get(ctx, `/campaigns/${segment(id)}/analytics`),
          "campaign analytics"
        )
      ),
    getCampaignSettings: async (id, ctx) =>
      toSettings(
        identity,
        id,
        objectOf(
          client,
          await client.get(ctx, `/campaigns/${segment(id)}`),
          "the campaign"
        )
      ),
    getSenderHealth: async (id, ctx) => {
      const account = objectOf(
        client,
        await client.get(ctx, `/email-accounts/${segment(id)}/`),
        "the email account"
      );

      const stats = await client.get(
        ctx,
        `/email-accounts/${segment(id)}/warmup-stats`
      );

      return toHealth(identity, account, unwrap(stats));
    },
    getList: async (id, ctx) =>
      toList(
        identity,
        objectOf(
          client,
          await client.get(ctx, `/lead-list/${segment(id)}`),
          "the lead list"
        )
      ),
    getWebhook: async (id, ctx) =>
      toWebhook(
        identity,
        null,
        objectOf(
          client,
          await client.get(ctx, `/webhook/${segment(id)}`),
          "the webhook"
        )
      ),
    listBlocklist: async (query, ctx) => {
      const page = await offsetPage(
        client,
        ctx,
        "/leads/get-domain-block-list",
        {
          limit: pageSize(query.limit, BLOCKLIST_PAGE_SIZE),
          offset: count(query.next) ?? 0,
        }
      );

      return flatMapPage(page, (entry) => toBlockEntry(identity, entry));
    },
    listLists: async (query, ctx) => {
      const page = await offsetPage(client, ctx, "/lead-list/", {
        limit: pageSize(query.limit),
        offset: count(query.next) ?? 0,
      });

      return mapPage(page, (row) => toList(identity, row));
    },
    // SmartDelivery answers with every test at once: no pages are documented.
    listPlacementTests: async (_query, ctx) => ({
      items: rowsOf(
        client,
        await client.delivery.post(ctx, "/spam-test/report", {}),
        "/spam-test/report"
      ).map((test) => toPlacementTest(identity, test)),
    }),
    listSubsequences: (query, ctx) => listSubsequences(client, ctx, query),
    // One response holds every tag of the account; there are no pages.
    listTags: async (_query, ctx) => ({
      items: rowsOf(
        client,
        await client.get(ctx, "/email-accounts/tags"),
        "/email-accounts/tags"
      ).map((tag) => toTag(identity, tag)),
    }),
    listWebhooks: (query, ctx) => listWebhooks(client, ctx, query),
  };
};
