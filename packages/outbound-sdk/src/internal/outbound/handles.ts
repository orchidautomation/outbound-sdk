// Handles: campaign(id), sender(id) and lead(id) scope the collections to
// one record, like files.file(key) in Files SDK.

import { requireCapability } from "../capabilities.ts";
import type { Message } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type {
  CampaignHandle,
  LeadHandle,
  ListAllOptions,
  PageResult,
  ReadCollection,
  SenderHandle,
} from "./api.ts";
import { makeGetter, makeReadCollection } from "./collections.ts";
import type { ListSpec } from "./collections.ts";
import type { Core } from "./core.ts";
import {
  campaignGet,
  leadGet,
  leadList,
  messageList,
  replyList,
  senderGet,
  senderList,
  sequenceGet,
} from "./specs.ts";
import { readStats } from "./stats.ts";
import { assertId } from "./validate.ts";

// A collection with one filter fixed, so campaign(id).leads only sees that campaign.
const scoped = <
  Item,
  Filters extends { readonly campaignId?: string | undefined },
>(
  core: Core,
  spec: ListSpec<Item, Filters>,
  campaignId: string
): ReadCollection<Item, Omit<Filters, "campaignId">> => {
  const collection = makeReadCollection(core, spec);

  // SAFETY: Filters is the scoped options plus campaignId, which is added here.
  const withCampaign = <Options>(
    options: Options | undefined
  ): Filters & ListAllOptions =>
    ({ ...options, campaignId }) as Filters & ListAllOptions;

  return {
    list: (options) => collection.list(withCampaign(options)),
    listAll: (options) => collection.listAll(withCampaign(options)),
  };
};

export const makeCampaignHandle = (core: Core, id: string): CampaignHandle => {
  const campaignId = assertId(id, "Campaign");
  const get = makeGetter(core, campaignGet());
  const sequence = makeGetter(core, sequenceGet(core));

  return {
    get: (options) => get(campaignId, options),
    id: campaignId,
    leads: scoped(core, leadList(core), campaignId),
    messages: scoped(core, messageList(core), campaignId),
    replies: scoped(core, replyList(core), campaignId),
    senders: scoped(core, senderList(core), campaignId),
    sequence: (options) => sequence(campaignId, options),
    stats: (options) =>
      readStats(core, {
        ...options,
        scope: options?.scope ?? "campaign",
        scopeId: campaignId,
      }),
  };
};

export const makeSenderHandle = (core: Core, id: string): SenderHandle => {
  const senderId = assertId(id, "Sender");
  const get = makeGetter(core, senderGet(core));

  return {
    get: (options) => get(senderId, options),
    id: senderId,
    stats: (options) =>
      readStats(core, { ...options, scope: "sender", scopeId: senderId }),
    warmup: async (options) => {
      requireCapability(
        core.gate,
        "senders.warmup",
        "Reading a sender's warmup"
      );
      const sender = await get(senderId, options);

      if (sender.warmup === null) {
        throw new OutboundError(
          "NotFound",
          `Sender ${senderId} has no warmup data`,
          {
            provider: core.adapter.name,
          }
        );
      }

      return sender.warmup;
    },
  };
};

const bySentAt = (left: Message, right: Message): number =>
  (left.sentAt ?? "").localeCompare(right.sentAt ?? "");

export const makeLeadHandle = (core: Core, id: string): LeadHandle => {
  const leadId = assertId(id, "Lead");
  const get = makeGetter(core, leadGet(core));
  const messages = makeReadCollection(core, messageList(core));

  return {
    get: (options) => get(leadId, options),
    id: leadId,
    timeline: async (options): Promise<PageResult<Message>> => {
      requireCapability(
        core.gate,
        "leads.timeline",
        "Reading a lead's timeline"
      );
      const walk = messages.listAll({ ...options, leadId });
      const items = await walk.toArray();

      if (walk.meta === undefined) {
        throw new OutboundError("Provider", "The timeline returned no page", {
          provider: core.adapter.name,
        });
      }

      return {
        complete: true,
        items: items.toSorted(bySentAt),
        meta: walk.meta,
      };
    },
  };
};
