// Handles: campaign(id), sender(id) and lead(id) scope the collections to
// one record, like files.file(key) in Files SDK.

import { requireCapability } from "../capabilities.ts";
import type { Message } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type {
  CampaignHandle,
  LeadHandle,
  ListAllOptions,
  ListHandle,
  PageResult,
  ReadCollection,
  SenderHandle,
  ThreadHandle,
} from "./api.ts";
import { makeGetter, makeReadCollection } from "./collections.ts";
import type { ListSpec } from "./collections.ts";
import type { Core } from "./core.ts";
import {
  healthGet,
  settingsGet,
  subsequenceList,
  webhookList,
} from "./specs-account.ts";
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
const scoped = <Item, Filters, Hidden extends keyof Filters = never>(
  core: Core,
  spec: ListSpec<Item, Filters>,
  fixed: Partial<Filters>
): ReadCollection<Item, Omit<Filters, Hidden>> => {
  const collection = makeReadCollection(core, spec);

  // SAFETY: Filters is the scoped options plus the fixed filter, which is added here.
  const withCampaign = <Options>(
    options: Options | undefined
  ): Filters & ListAllOptions =>
    ({ ...options, ...fixed }) as Filters & ListAllOptions;

  return {
    list: (options) => collection.list(withCampaign(options)),
    listAll: (options) => collection.listAll(withCampaign(options)),
  };
};

export const makeCampaignHandle = (core: Core, id: string): CampaignHandle => {
  const campaignId = assertId(id, "Campaign");
  const get = makeGetter(core, campaignGet());
  const sequence = makeGetter(core, sequenceGet(core));
  const settings = makeGetter(core, settingsGet(core));
  const fixed = { campaignId };

  return {
    get: (options) => get(campaignId, options),
    id: campaignId,
    leads: scoped(core, leadList(core), fixed),
    messages: scoped(core, messageList(core), fixed),
    replies: scoped(core, replyList(core), fixed),
    senders: scoped(core, senderList(core), fixed),
    sequence: (options) => sequence(campaignId, options),
    settings: (options) => settings(campaignId, options),
    subsequences: scoped(core, subsequenceList(core), fixed),
    webhooks: scoped(core, webhookList(core), fixed),
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
  const health = makeGetter(core, healthGet(core));

  return {
    get: (options) => get(senderId, options),
    health: (options) => health(senderId, options),
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

const collect = async (
  core: Core,
  walk: ReturnType<ReadCollection<Message, object>["listAll"]>,
  what: string
): Promise<PageResult<Message>> => {
  const items = await walk.toArray();

  if (walk.meta === undefined) {
    throw new OutboundError("Provider", `The ${what} returned no page`, {
      provider: core.adapter.name,
    });
  }

  return {
    complete: true,
    failures: [],
    items: items.toSorted(bySentAt),
    meta: walk.meta,
  };
};

export const makeLeadHandle = (core: Core, id: string): LeadHandle => {
  const leadId = assertId(id, "Lead");
  const get = makeGetter(core, leadGet(core));
  const messages = makeReadCollection(core, messageList(core));

  return {
    get: (options) => get(leadId, options),
    id: leadId,
    // Async, so a refused read rejects like every other failure of the call.
    timeline: async (options): Promise<PageResult<Message>> => {
      requireCapability(
        core.gate,
        "leads.timeline",
        "Reading a lead's timeline"
      );

      return await collect(
        core,
        messages.listAll({ ...options, leadId }),
        "timeline"
      );
    },
  };
};

export const makeListHandle = (core: Core, id: string): ListHandle => {
  const listId = assertId(id, "List");

  return { id: listId, leads: scoped(core, leadList(core), { listId }) };
};

export const makeThreadHandle = (core: Core, id: string): ThreadHandle => {
  const threadId = assertId(id, "Thread");
  const messages = makeReadCollection(core, messageList(core));

  return {
    id: threadId,
    // Async, so a refused read rejects like every other failure of the call.
    messages: async (options): Promise<PageResult<Message>> =>
      await collect(core, messages.listAll({ ...options, threadId }), "thread"),
  };
};
