// Messages and replies. Both come from `GET /emails`, which has its own
// rate limit.

import type {
  Adapter,
  AdapterContext,
  MessageQuery,
  Page,
  ReplyQuery,
} from "../internal/adapter.ts";
import type { Message, Reply } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { emailAddress, field, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { mapPage } from "../internal/page.ts";
import { EMAILS_LANE } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import {
  isScheduled,
  isSentByHand,
  isTruncated,
  toMessage,
  toReply,
} from "./map-lead.ts";
import { listEnvelope } from "./map.ts";
import { pageSize, readLabels } from "./pages.ts";
import { withAnsweredSteps } from "./thread.ts";

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

  // A message's leadRef is the lead's address already.
  const given = emailAddress(leadId);

  if (given !== null) {
    return given;
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

// A list response cuts a large body down to an excerpt and says so. The
// email read on its own has the whole body.
const withFullBody = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  item: JsonObject
): Promise<JsonObject> => {
  const id = text(item.id);

  return id === null || !isTruncated(item)
    ? item
    : await client.getObject(ctx, `/emails/${encodeURIComponent(id)}`, {
        lane: EMAILS_LANE,
      });
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
  const threadId = "threadId" in query ? query.threadId : undefined;
  const byHand = "byHand" in query && query.byHand === true;
  const sentByHand = byHand ? "manual" : undefined;
  const lead = await leadAddress(client, ctx, leadId, cursor);

  const envelope = listEnvelope(
    await client.get(ctx, "/emails", {
      lane: EMAILS_LANE,
      query: {
        campaign_id: query.campaignId,
        email_type: received ? "received" : sentByHand,
        is_unread: "unread" in query ? query.unread : undefined,
        lead,
        limit: pageSize(query.limit),
        max_timestamp_created: query.until,
        min_timestamp_created: query.since,
        search: threadId === undefined ? undefined : `thread:${threadId}`,
        starting_after: cursor.after,
      },
    }),
    client.identity.provider,
    "/emails"
  );

  // `manual` is not described beyond its name, so a hand-sent email is also
  // checked by its own `ue_type`.
  const sent = envelope.items.filter((item) =>
    byHand ? isSentByHand(item) : !isScheduled(item)
  );

  return {
    items: query.includeBody
      ? await Promise.all(
          sent.map(async (item) => await withFullBody(client, ctx, item))
        )
      : sent,
    next:
      envelope.next === undefined
        ? undefined
        : { after: envelope.next, lead: lead ?? null },
  };
};

export const mailReaders = (
  client: InstantlyClient
): Pick<Adapter, "listMessages" | "listReplies"> => ({
  listMessages: async (query, ctx): Promise<Page<Message>> => {
    const page = await listEmails(client, ctx, query, false);

    const mapped = mapPage(page, (item) =>
      toMessage(client.identity, item, query.includeBody)
    );

    return { ...mapped, items: withAnsweredSteps(mapped.items) };
  },
  listReplies: async (query, ctx): Promise<Page<Reply>> => {
    const page = await listEmails(client, ctx, query, true);

    const labels = await readLabels(
      client,
      ctx,
      page.items.map((item) => item.i_status)
    );

    const replies = page.items.map((item) =>
      toReply(client.identity, item, query.includeBody, labels)
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
