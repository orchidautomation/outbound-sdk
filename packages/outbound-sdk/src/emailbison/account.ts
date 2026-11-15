// The EmailBison readers for account records: campaign settings, sender
// health, lead lists, the block list, tags, webhooks and workspaces. One page
// per call.

import type { Adapter, AdapterContext, Page } from "../internal/adapter.ts";
import type { BlockEntry, SenderHealth } from "../internal/entities-account.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, field, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { flatMapPage, mapPage } from "../internal/page.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { EmailBisonClient } from "./client.ts";
import {
  senderStatus,
  toBlockEntry,
  toLeadList,
  toSettings,
  toTag,
  toWebhook,
  toWorkspace,
} from "./map.ts";

type Readers = Pick<
  Adapter,
  | "getCampaignSettings"
  | "getList"
  | "getSenderHealth"
  | "getWebhook"
  | "listBlocklist"
  | "listLists"
  | "listTags"
  | "listWebhooks"
  | "listWorkspaces"
>;

const DAY_MS = 86_400_000;

/** The warmup window sender health reads: the last 7 days, in UTC days. */
export const WARMUP_DAYS = 7;

const day = (time: number): string => new Date(time).toISOString().slice(0, 10);

const segment = (id: string): string => encodeURIComponent(id);

const toHealth = (
  client: EmailBisonClient,
  sender: JsonObject,
  warmup: JsonObject,
  senderId: string
): SenderHealth => {
  const status = senderStatus(sender);
  const domain = text(warmup.domain) ?? text(sender.email)?.split("@")[1];

  return {
    ...recordBase(client.identity, senderId, { sender, warmup }),
    blacklisted: null,
    checkedAt: null,
    connected: status === "unknown" ? null : status === "active",
    dns: { dkim: null, dmarc: null, mx: null, spf: null },
    domain: domain?.toLowerCase() ?? null,
    issues: [],
    senderRef: refTo(client.identity, senderId) ?? "",
    warmup: {
      // Inbox placement of warmup mail is not reported.
      inbox: null,
      received: count(warmup.warmup_replies_received),
      score: count(warmup.warmup_score),
      sent: count(warmup.warmup_emails_sent),
      spam: count(warmup.warmup_emails_saved_from_spam),
    },
  };
};

// The block list is two lists, read in turn; `next.list` says which.
const listBlocklist = async (
  client: EmailBisonClient,
  ctx: AdapterContext,
  at: Json | undefined
): Promise<Page<BlockEntry>> => {
  const { identity } = client;

  if (field(at, "list") !== "domains") {
    const page = flatMapPage(
      await client.page(ctx, "/api/blacklisted-emails", field(at, "page"), {
        cursor: true,
      }),
      (row) => toBlockEntry(identity, row, "email")
    );

    return {
      items: page.items,
      next:
        page.next === undefined
          ? { list: "domains" }
          : { list: "emails", page: page.next },
    };
  }

  const page = flatMapPage(
    await client.page(ctx, "/api/blacklisted-domains", field(at, "page")),
    (row) => toBlockEntry(identity, row, "domain")
  );

  return {
    items: page.items,
    next:
      page.next === undefined
        ? undefined
        : { list: "domains", page: page.next },
  };
};

export const accountReaders = (
  client: EmailBisonClient,
  now: () => number = Date.now
): Readers => {
  const { identity } = client;

  return {
    getCampaignSettings: async (id, ctx) => {
      const path = `/api/campaigns/${segment(id)}`;
      const campaign = client.one(await client.get(ctx, path), path);
      const schedulePath = `${path}/schedule`;

      let schedule: JsonObject | null = null;

      try {
        schedule = client.one(
          await client.get(ctx, schedulePath),
          schedulePath
        );
      } catch (error) {
        // A campaign that was never scheduled has no schedule to read.
        if (!OutboundError.is(error) || error.code !== "NotFound") {
          throw error;
        }
      }

      return toSettings(identity, campaign, schedule);
    },
    getList: async (id, ctx) => {
      const path = `/api/lead-lists/${segment(id)}`;

      return toLeadList(
        identity,
        client.one(await client.get(ctx, path), path)
      );
    },
    getSenderHealth: async (id, ctx) => {
      const path = `/api/sender-emails/${segment(id)}`;
      const sender = client.one(await client.get(ctx, path), path);
      const end = now();
      const warmupPath = `/api/warmup/sender-emails/${segment(id)}`;

      const warmup = client.one(
        await client.get(ctx, warmupPath, {
          query: {
            end_date: day(end),
            start_date: day(end - WARMUP_DAYS * DAY_MS),
          },
        }),
        warmupPath
      );

      return toHealth(client, sender, warmup, id);
    },
    getWebhook: async (id, ctx) => {
      const path = `/api/webhook-url/${segment(id)}`;

      return toWebhook(identity, client.one(await client.get(ctx, path), path));
    },
    listBlocklist: async (query, ctx) =>
      await listBlocklist(client, ctx, query.next),
    listLists: async (query, ctx) =>
      mapPage(await client.page(ctx, "/api/lead-lists", query.next), (row) =>
        toLeadList(identity, row)
      ),
    listTags: async (_query, ctx) => {
      const path = "/api/tags";

      // Documented without pages: one answer holds every tag.
      return {
        items: client
          .rows(await client.get(ctx, path), path)
          .flatMap((row) => toTag(identity, row)),
      };
    },
    listWebhooks: async (query, ctx) =>
      mapPage(await client.page(ctx, "/api/webhook-url", query.next), (row) =>
        toWebhook(identity, row)
      ),
    listWorkspaces: async (_query, ctx) => {
      const path = "/api/workspaces/v1.1";

      return {
        items: objects(client.rows(await client.get(ctx, path), path)).map(
          (row) => toWorkspace(identity, row)
        ),
      };
    },
  };
};
