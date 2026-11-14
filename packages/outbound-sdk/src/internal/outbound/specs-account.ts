// The account-level collections and lookups, and the capability each needs.

import { requireCapability } from "../capabilities.ts";
import {
  blockEntrySchema,
  campaignSettingsSchema,
  leadListSchema,
  senderHealthSchema,
  tagSchema,
  webhookSubscriptionSchema,
} from "../entities-account.ts";
import type {
  BlockEntry,
  CampaignSettings,
  LeadList,
  SenderHealth,
  Tag,
  WebhookSubscription,
} from "../entities-account.ts";
import { sequenceSchema } from "../entities.ts";
import type { Sequence } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { WebhookFilters } from "./api.ts";
import type { GetSpec, ListSpec } from "./collections.ts";
import type { Core } from "./core.ts";

type NoFilters = Record<never, never>;

const refOf = (item: { readonly ref: string }): string => item.ref;

export const settingsGet = (core: Core): GetSpec<CampaignSettings> => ({
  action: "campaigns.settings",
  prepare: () => {
    requireCapability(
      core.gate,
      "campaigns.settings",
      "Reading a campaign's settings"
    );
  },
  schema: campaignSettingsSchema,
  toOperation: (id) => ({ id, kind: "campaigns.settings" }),
  what: "Settings for campaign",
});

export const healthGet = (core: Core): GetSpec<SenderHealth> => ({
  action: "senders.health",
  prepare: () => {
    requireCapability(core.gate, "senders.health", "Reading a sender's health");
  },
  schema: senderHealthSchema,
  toOperation: (id) => ({ id, kind: "senders.health" }),
  what: "Health for sender",
});

export const subsequenceList = (
  core: Core
): ListSpec<Sequence, { readonly campaignId?: string | undefined }> => ({
  action: "sequence.subsequences",
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(
      core.gate,
      "sequence.subsequences",
      "Listing a campaign's subsequences"
    );

    return { campaignId: filters.campaignId };
  },
  schema: sequenceSchema,
  toOperation: (filters, page) => {
    if (filters.campaignId === undefined) {
      throw new OutboundError("Invalid", "Subsequences need a campaign id");
    }

    return {
      kind: "sequence.subsequences",
      query: { campaignId: filters.campaignId, ...page },
    };
  },
});

export const listList = (core: Core): ListSpec<LeadList, NoFilters> => ({
  action: "lists.list",
  keyOf: refOf,
  prepare: () => {
    requireCapability(core.gate, "lists.list", "Listing lead lists");

    return {};
  },
  schema: leadListSchema,
  toOperation: (_filters, page) => ({ kind: "lists.list", query: page }),
});

export const blocklistList = (core: Core): ListSpec<BlockEntry, NoFilters> => ({
  action: "blocklist.list",
  keyOf: refOf,
  prepare: () => {
    requireCapability(core.gate, "blocklist", "Listing the block list");

    return {};
  },
  schema: blockEntrySchema,
  toOperation: (_filters, page) => ({ kind: "blocklist.list", query: page }),
});

export const tagList = (core: Core): ListSpec<Tag, NoFilters> => ({
  action: "tags.list",
  keyOf: refOf,
  prepare: () => {
    requireCapability(core.gate, "tags", "Listing tags");

    return {};
  },
  schema: tagSchema,
  toOperation: (_filters, page) => ({ kind: "tags.list", query: page }),
});

export const webhookList = (
  core: Core
): ListSpec<WebhookSubscription, WebhookFilters> => ({
  action: "webhooks.list",
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(core.gate, "webhooks.list", "Listing webhooks");

    return { campaignId: filters.campaignId };
  },
  schema: webhookSubscriptionSchema,
  toOperation: (filters, page) => ({
    kind: "webhooks.list",
    query: { ...filters, ...page },
  }),
});
