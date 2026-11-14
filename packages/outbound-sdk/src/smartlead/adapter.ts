// The Smartlead adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  Page,
  SenderQuery,
} from "../internal/adapter.ts";
import type { Sender } from "../internal/entities.ts";
import { count, objects } from "../internal/json.ts";
import { accountReaders } from "./account.ts";
import type { SmartleadClient } from "./client.ts";
import { getLead, listLeads } from "./leads.ts";
import { listMessages, listReplies } from "./mail.ts";
import {
  toCampaign,
  toSender,
  toSequence,
  toWorkspace,
  unwrap,
} from "./map.ts";
import {
  campaignList,
  objectOf,
  offsetPage,
  pageSize,
  segment,
} from "./shared.ts";
import { readStats } from "./stats.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getCampaignSettings"
  | "getLead"
  | "getSender"
  | "getSenderHealth"
  | "getSequence"
  | "listBlocklist"
  | "listCampaigns"
  | "listLeads"
  | "listLists"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "listSubsequences"
  | "listTags"
  | "listWebhooks"
  | "listWorkspaces"
  | "stats"
>;

const listSenders = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  query: SenderQuery
): Promise<Page<Sender>> => {
  if (query.campaignId !== undefined) {
    // A campaign's mailboxes come in one response, bare or wrapped.
    const attached = await client.get(
      ctx,
      `/campaigns/${segment(query.campaignId)}/email-accounts`
    );

    return {
      items: objects(unwrap(attached)).map((account) =>
        toSender(client.identity, account)
      ),
    };
  }

  const page = await offsetPage(client, ctx, "/email-accounts/", {
    limit: pageSize(query.limit),
    offset: count(query.next) ?? 0,
  });

  return {
    items: page.rows.map((account) => toSender(client.identity, account)),
    next: page.next,
  };
};

export const readers = (client: SmartleadClient): Readers => {
  const { identity } = client;

  return {
    ...accountReaders(client),
    getCampaign: async (id, ctx) =>
      toCampaign(
        identity,
        objectOf(
          client,
          await client.get(ctx, `/campaigns/${segment(id)}`, {
            query: { include_tags: true },
          }),
          "the campaign"
        )
      ),
    getLead: (id, ctx) => getLead(client, ctx, id),
    getSender: async (id, ctx) =>
      toSender(
        identity,
        objectOf(
          client,
          // The documented path ends with a slash.
          await client.get(ctx, `/email-accounts/${segment(id)}/`),
          "the email account"
        )
      ),
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        id,
        await client.get(ctx, `/campaigns/${segment(id)}/sequences`)
      ),
    listCampaigns: async (_query, ctx) => {
      const campaigns = await campaignList(client, ctx);

      return {
        items: campaigns.map((campaign) => toCampaign(identity, campaign)),
      };
    },
    listLeads: (query, ctx) => listLeads(client, ctx, query),
    listMessages: (query, ctx) => listMessages(client, ctx, query),
    listReplies: (query, ctx) => listReplies(client, ctx, query),
    listSenders: (query, ctx) => listSenders(client, ctx, query),
    listWorkspaces: async (_query, ctx) => ({
      items: objects(unwrap(await client.get(ctx, "/client/"))).map((raw) =>
        toWorkspace(identity, raw)
      ),
    }),
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
