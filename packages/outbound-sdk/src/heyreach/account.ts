// HeyReach's account-level reads: lead lists, the blacklist, webhooks, a
// LinkedIn account's connection state and the accounts behind one campaign.
// One vendor page per call.

import type {
  Adapter,
  AdapterContext,
  Page,
  SenderQuery,
} from "../internal/adapter.ts";
import type { Sender } from "../internal/entities.ts";
import {
  count,
  field,
  isJsonObject,
  isNumber,
  list,
} from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import type { HeyReachClient } from "./client.ts";
import {
  toBlockedCompany,
  toBlockedLead,
  toCampaignProgress,
  toLeadList,
  toSenderHealth,
  toWebhook,
  webhookCampaigns,
} from "./map-account.ts";
import { listEnvelope, toSender } from "./map.ts";
import { numericId, offsetOf, pageSize } from "./paging.ts";

type AccountReaders = Required<
  Pick<
    Adapter,
    | "getCampaignProgress"
    | "getList"
    | "getSenderHealth"
    | "getWebhook"
    | "listBlocklist"
    | "listLists"
    | "listWebhooks"
  >
>;

// The blacklist is two lists, read one after the other: every page of leads,
// then every page of companies. `next` says which list and where in it.
const COMPANIES = "companies";

const blocklistCursor = (next: Json | undefined) => ({
  companies: field(next, "list") === COMPANIES,
  offset: count(field(next, "offset")) ?? 0,
});

const listBlocklist =
  (client: HeyReachClient): AccountReaders["listBlocklist"] =>
  async (query, ctx) => {
    const { companies, offset } = blocklistCursor(query.next);

    const path = companies ? "/blacklist/GetCompanies" : "/blacklist/GetLeads";

    const envelope = listEnvelope(
      await client.post(ctx, path, { limit: pageSize(query.limit), offset }),
      offset,
      client.identity.provider,
      path
    );

    const toEntries = companies ? toBlockedCompany : toBlockedLead;

    const items = envelope.items.flatMap((item) =>
      toEntries(client.identity, item)
    );

    if (envelope.next !== undefined) {
      return {
        items,
        next: { list: companies ? COMPANIES : "leads", offset: envelope.next },
      };
    }

    return companies
      ? { items }
      : { items, next: { list: COMPANIES, offset: 0 } };
  };

/** Lists, blacklist, webhooks and sender health. */
export const accountReaders = (client: HeyReachClient): AccountReaders => ({
  getSenderHealth: async (id, ctx) => {
    const path = `/li_account/GetAccountStatus/${numericId(client, id, "account")}`;

    return toSenderHealth(
      client.identity,
      id,
      client.object(await client.get(ctx, path), path)
    );
  },
  getCampaignProgress: async (id, ctx) => {
    const path = "/campaign/GetById";

    return toCampaignProgress(
      client.identity,
      id,
      client.object(
        await client.get(ctx, path, {
          query: { campaignId: numericId(client, id, "campaign") },
        }),
        path
      )
    );
  },
  getList: async (id, ctx) => {
    const path = "/list/GetById";

    return toLeadList(
      client.identity,
      client.object(
        await client.get(ctx, path, {
          query: { listId: numericId(client, id, "list") },
        }),
        path
      )
    );
  },
  getWebhook: async (id, ctx) => {
    const path = "/webhooks/GetWebhookById";

    // The client asks for this read without the webhook's custom headers.
    return toWebhook(
      client.identity,
      client.object(
        await client.get(ctx, path, {
          query: { webhookId: numericId(client, id, "webhook") },
        }),
        path
      )
    );
  },
  listBlocklist: listBlocklist(client),
  listLists: async (query, ctx) => {
    const offset = offsetOf(query.next);

    const envelope = listEnvelope(
      await client.post(ctx, "/list/GetAll", {
        limit: pageSize(query.limit),
        offset,
      }),
      offset,
      client.identity.provider,
      "/list/GetAll"
    );

    return mapPage(envelope, (item) => toLeadList(client.identity, item));
  },
  listWebhooks: async (query, ctx) => {
    const offset = offsetOf(query.next);

    const envelope = listEnvelope(
      await client.post(ctx, "/webhooks/GetAllWebhooks", {
        // Custom headers can hold a shared secret, so they are never asked for.
        includeCustomHeaders: false,
        limit: pageSize(query.limit),
        offset,
      }),
      offset,
      client.identity.provider,
      "/webhooks/GetAllWebhooks"
    );

    const { campaignId } = query;

    return {
      // The endpoint has no campaign filter. A webhook with no campaign ids
      // fires for every campaign, so it belongs to each one.
      items: envelope.items
        .filter((item) => {
          const campaigns = webhookCampaigns(item);

          return (
            campaignId === undefined ||
            campaigns.length === 0 ||
            campaigns.includes(campaignId)
          );
        })
        .map((item) => toWebhook(client.identity, item)),
      next: envelope.next,
    };
  },
});

// A campaign names its accounts by id (`campaignAccountIds`) and no endpoint
// lists accounts by campaign, so the campaign is read once and the account
// list is read a page at a time and narrowed to those ids. `next` carries
// the ids, so only the first page reads the campaign.
const campaignAccountIds = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: SenderQuery & { readonly campaignId: string }
): Promise<number[]> => {
  const carried = field(query.next, "accountIds");

  if (carried !== undefined) {
    return list(carried).filter((id) => isNumber(id));
  }

  const path = "/campaign/GetById";

  const campaign = client.object(
    await client.get(ctx, path, {
      query: { campaignId: numericId(client, query.campaignId, "campaign") },
    }),
    path
  );

  return list(campaign.campaignAccountIds).filter((id) => isNumber(id));
};

/** The LinkedIn accounts attached to one campaign. */
export const campaignSenders = async (
  client: HeyReachClient,
  ctx: AdapterContext,
  query: SenderQuery & { readonly campaignId: string }
): Promise<Page<Sender>> => {
  const accountIds = await campaignAccountIds(client, ctx, query);

  if (accountIds.length === 0) {
    return { items: [] };
  }

  const cursor = isJsonObject(query.next) ? query.next.offset : undefined;
  const offset = offsetOf(cursor);

  const envelope = listEnvelope(
    await client.post(ctx, "/li_account/GetAll", {
      limit: pageSize(query.limit),
      offset,
    }),
    offset,
    client.identity.provider,
    "/li_account/GetAll"
  );

  return {
    items: envelope.items
      .filter((item) => isNumber(item.id) && accountIds.includes(item.id))
      .map((item) => toSender(client.identity, item)),
    next:
      envelope.next === undefined
        ? undefined
        : { accountIds, offset: envelope.next },
  };
};
