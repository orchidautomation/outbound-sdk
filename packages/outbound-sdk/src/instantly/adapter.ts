// The Instantly adapter's read methods. One page per call; the wrapper
// loops, throttles and retries.

import type {
  Adapter,
  AdapterContext,
  MessageQuery,
  Page,
  ReplyQuery,
} from "../internal/adapter.ts";
import type { Message, Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { field, isJsonObject, isString, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { EMAILS_LANE, PAGE_SIZE } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import {
  campaignStatusCode,
  isScheduled,
  listEnvelope,
  toCampaign,
  toLead,
  toMessage,
  toReply,
  toSender,
  toSequence,
  toWorkspace,
} from "./map.ts";
import { readStats } from "./stats.ts";

type Readers = Pick<
  Adapter,
  | "getCampaign"
  | "getLead"
  | "getSender"
  | "getSequence"
  | "listCampaigns"
  | "listLeads"
  | "listMessages"
  | "listReplies"
  | "listSenders"
  | "listWorkspaces"
  | "stats"
>;

const pageSize = (limit: number | undefined): number =>
  Math.min(limit ?? PAGE_SIZE, PAGE_SIZE);

const after = (next: Json | undefined): string | undefined =>
  isString(next) ? next : undefined;

interface EmailCursor {
  readonly after: string | undefined;
  /** The lead's address, resolved once and carried in the cursor. */
  readonly lead: string | undefined;
}

const emailCursor = (next: Json | undefined): EmailCursor => ({
  after: text(field(next, "after")) ?? undefined,
  lead: text(field(next, "lead")) ?? undefined,
});

// GET /emails filters by the lead's address, not its id.
const leadAddress = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  leadId: string | undefined,
  cursor: EmailCursor
): Promise<string | undefined> => {
  if (leadId === undefined || cursor.lead !== undefined) {
    return cursor.lead;
  }

  const lead = await client.getObject(
    ctx,
    `/leads/${encodeURIComponent(leadId)}`
  );

  const address = text(lead.email);

  if (address === null) {
    throw new OutboundError("NotFound", `Lead ${leadId} has no email address`, {
      provider: client.identity.provider,
    });
  }

  return address;
};

interface EmailPage {
  readonly items: JsonObject[];
  readonly next: Json | undefined;
}

const listEmails = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  query: MessageQuery | ReplyQuery,
  received: boolean
): Promise<EmailPage> => {
  const cursor = emailCursor(query.next);
  const leadId = "leadId" in query ? query.leadId : undefined;
  const lead = await leadAddress(client, ctx, leadId, cursor);

  const envelope = listEnvelope(
    await client.get(ctx, "/emails", {
      lane: EMAILS_LANE,
      query: {
        campaign_id: query.campaignId,
        email_type: received ? "received" : undefined,
        lead,
        limit: pageSize(query.limit),
        max_timestamp_created: query.until,
        min_timestamp_created: query.since,
        starting_after: cursor.after,
      },
    })
  );

  return {
    items: envelope.items.filter((item) => !isScheduled(item)),
    next:
      envelope.next === undefined
        ? undefined
        : { after: envelope.next, lead: lead ?? null },
  };
};

const mailReaders = (
  client: InstantlyClient
): Pick<Readers, "listMessages" | "listReplies"> => ({
  listMessages: async (query, ctx): Promise<Page<Message>> => {
    const page = await listEmails(client, ctx, query, false);

    return {
      items: page.items.map((item) =>
        toMessage(client.identity, item, query.includeBody)
      ),
      next: page.next,
    };
  },
  listReplies: async (query, ctx): Promise<Page<Reply>> => {
    const page = await listEmails(client, ctx, query, true);

    const replies = page.items.map((item) =>
      toReply(client.identity, item, query.includeBody)
    );

    return {
      // One i_status value fits in the query but a category maps to several, so
      // the category is matched here on the mapped value.
      items:
        query.category === undefined
          ? replies
          : replies.filter((reply) => reply.category === query.category),
      next: page.next,
    };
  },
});

export const readers = (client: InstantlyClient): Readers => {
  const { identity } = client;

  return {
    ...mailReaders(client),
    getCampaign: async (id, ctx) =>
      toCampaign(
        identity,
        await client.getObject(ctx, `/campaigns/${encodeURIComponent(id)}`)
      ),
    getLead: async (id, ctx) =>
      toLead(
        identity,
        await client.getObject(ctx, `/leads/${encodeURIComponent(id)}`)
      ),
    getSender: async (id, ctx) =>
      toSender(
        identity,
        await client.getObject(ctx, `/accounts/${encodeURIComponent(id)}`)
      ),
    getSequence: async (id, ctx) =>
      toSequence(
        identity,
        await client.getObject(ctx, `/campaigns/${encodeURIComponent(id)}`)
      ),
    listCampaigns: async (query, ctx) => {
      const status =
        query.status === undefined
          ? undefined
          : campaignStatusCode(query.status);

      if (query.status !== undefined && status === undefined) {
        // Instantly has no archived or unknown campaigns.
        return { items: [] };
      }

      const envelope = listEnvelope(
        await client.get(ctx, "/campaigns", {
          query: {
            limit: pageSize(query.limit),
            starting_after: after(query.next),
            status,
          },
        })
      );

      return {
        items: envelope.items.map((item) => toCampaign(identity, item)),
        next: envelope.next,
      };
    },
    listLeads: async (query, ctx) => {
      const body: JsonObject = { limit: pageSize(query.limit) };

      if (query.campaignId !== undefined) {
        body.campaign = query.campaignId;
      }

      if (isString(query.next)) {
        body.starting_after = query.next;
      }

      const envelope = listEnvelope(
        await client.post(ctx, "/leads/list", body)
      );

      return {
        items: envelope.items.map((item) => toLead(identity, item)),
        next: envelope.next,
      };
    },
    listSenders: async (query, ctx) => {
      const envelope = listEnvelope(
        await client.get(ctx, "/accounts", {
          query: {
            limit: pageSize(query.limit),
            starting_after: after(query.next),
          },
        })
      );

      return {
        items: envelope.items.map((item) => toSender(identity, item)),
        next: envelope.next,
      };
    },
    listWorkspaces: async (_query, ctx) => {
      const workspace = await client.get(ctx, "/workspaces/current");

      return {
        items: isJsonObject(workspace)
          ? [toWorkspace(identity, workspace)]
          : [],
      };
    },
    stats: (query, ctx) => readStats(client, ctx, query),
  };
};
