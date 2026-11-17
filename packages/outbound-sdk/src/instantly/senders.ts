// Instantly's mailboxes: the workspace's or one campaign's, as senders or
// with their health. A page of health is three requests: the page of
// accounts, one DNS test for every domain on it and one warmup report for
// every mailbox on it, where one mailbox's health is three on its own.

import type {
  Adapter,
  AdapterContext,
  Page,
  SenderQuery,
} from "../internal/adapter.ts";
import type { SenderHealth } from "../internal/entities-account.ts";
import { emailAddress, field, list, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import type { InstantlyClient } from "./client.ts";
import { toSenderHealth } from "./map-account.ts";
import { toSender } from "./map.ts";
import { listPage } from "./pages.ts";

/**
 * A campaign names its mailboxes by address (`email_list`) and by tag
 * (`email_tag_list`). The accounts list is read and matched against both;
 * when only tags are named, Instantly filters by them itself.
 */
const campaignAccounts = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: SenderQuery & { readonly campaignId: string }
): Promise<Page<JsonObject>> => {
  const campaign = await client.getObject(
    ctx,
    `/campaigns/${encodeURIComponent(query.campaignId)}`
  );

  const addresses = new Set(
    list(campaign.email_list).flatMap((value) => emailAddress(value) ?? [])
  );

  const tagIds = new Set(
    list(campaign.email_tag_list).flatMap((value) => text(value) ?? [])
  );

  if (addresses.size === 0 && tagIds.size === 0) {
    return { items: [] };
  }

  const byTagOnly = addresses.size === 0;

  const page = await listPage(client, ctx, "/accounts", query, {
    include_tags: byTagOnly || tagIds.size === 0 ? undefined : true,
    tag_ids: byTagOnly ? [...tagIds].join(",") : undefined,
  });

  const attached = (account: JsonObject): boolean =>
    byTagOnly ||
    addresses.has(emailAddress(account.email) ?? "") ||
    objects(account.tags).some((tag) => tagIds.has(text(tag.id) ?? ""));

  return { items: page.items.filter(attached), next: page.next };
};

/** One page of the account objects, the workspace's or one campaign's. */
const accountsPage = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: SenderQuery
): Promise<Page<JsonObject>> =>
  query.campaignId === undefined
    ? await listPage(client, ctx, "/accounts", query, { include_tags: true })
    : await campaignAccounts(client, ctx, {
        ...query,
        campaignId: query.campaignId,
      });

const domainOf = (address: string): string => address.split("@").at(-1) ?? "";

/**
 * The DNS test's entries for one domain only. Passing the whole answer would
 * let a mailbox whose domain the test left out take another domain's entry.
 */
const vitalsOf = (vitals: Json, domain: string): JsonObject => {
  const mine = (key: string): JsonObject[] =>
    objects(field(vitals, key)).filter(
      (entry) => text(entry.domain)?.toLowerCase() === domain
    );

  return {
    failure_list: mine("failure_list"),
    success_list: mine("success_list"),
  };
};

const healthOf = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  accounts: readonly JsonObject[]
): Promise<SenderHealth[]> => {
  const addresses = accounts.flatMap(
    (account) => emailAddress(account.email) ?? []
  );

  if (addresses.length === 0) {
    return [];
  }

  // The test answers per domain, so one mailbox of each domain is enough.
  const firstOfDomain = new Map<string, string>();

  for (const address of addresses) {
    if (!firstOfDomain.has(domainOf(address))) {
      firstOfDomain.set(domainOf(address), address);
    }
  }

  // Both are POSTs that only read: a DNS test and a report. A page holds at
  // most 100 mailboxes, the most the warmup report takes.
  const vitals = await client.post(ctx, "/accounts/test/vitals", {
    accounts: [...firstOfDomain.values()],
  });

  const warmup = await client.post(ctx, "/accounts/warmup-analytics", {
    emails: addresses,
  });

  return accounts.flatMap((account) => {
    const address = emailAddress(account.email);

    return address === null
      ? []
      : [
          toSenderHealth(client.identity, address, {
            account,
            vitals: vitalsOf(vitals, domainOf(address)),
            warmup,
          }),
        ];
  });
};

export const senderReaders = (
  client: InstantlyClient
): Pick<Adapter, "listSenderHealth" | "listSenders"> => ({
  listSenderHealth: async (query, ctx) => {
    const page = await accountsPage(client, ctx, query);

    return { items: await healthOf(client, ctx, page.items), next: page.next };
  },
  listSenders: async (query, ctx) =>
    mapPage(await accountsPage(client, ctx, query), (account) =>
      toSender(client.identity, account, ctx.note)
    ),
});
