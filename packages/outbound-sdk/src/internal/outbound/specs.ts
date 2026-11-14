// What each collection needs from the adapter, and which capability each
// filter depends on. The checks here run before any plugin or request.

import { requireCapability } from "../capabilities.ts";
import {
  campaignSchema,
  leadSchema,
  messageSchema,
  replySchema,
  senderSchema,
  sequenceSchema,
  workspaceSchema,
} from "../entities.ts";
import type {
  Campaign,
  Lead,
  Message,
  Reply,
  Sender,
  Sequence,
  Workspace,
} from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type {
  CampaignFilters,
  Include,
  LeadFilters,
  MessageFilters,
  ReplyFilters,
  SenderFilters,
} from "./api.ts";
import type { GetSpec, ListSpec } from "./collections.ts";
import type { Core } from "./core.ts";
import { normalizeRange } from "./validate.ts";

const wantsBody = (include: readonly Include[] | undefined): boolean =>
  include?.includes("body") ?? false;

const hasRange = (filters: {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}) => filters.since !== undefined || filters.until !== undefined;

const refOf = (item: { readonly ref: string }): string => item.ref;

export const campaignList = (
  core: Core
): ListSpec<Campaign, CampaignFilters> => ({
  action: "campaigns.list",
  keyOf: refOf,
  prepare: (filters) => {
    if (filters.status !== undefined) {
      requireCapability(
        core.gate,
        "campaigns.status",
        "Filtering campaigns by status"
      );
    }

    return { status: filters.status };
  },
  schema: campaignSchema,
  toOperation: (filters, page) => ({
    kind: "campaigns.list",
    query: { ...filters, ...page },
  }),
});

export const campaignGet = (): GetSpec<Campaign> => ({
  action: "campaigns.get",
  prepare: () => {
    // Every adapter can get a campaign.
  },
  schema: campaignSchema,
  toOperation: (id) => ({ id, kind: "campaigns.get" }),
  what: "Campaign",
});

export const sequenceGet = (core: Core): GetSpec<Sequence> => ({
  action: "sequence.get",
  prepare: () => {
    requireCapability(core.gate, "sequence", "Reading a campaign's sequence");
  },
  schema: sequenceSchema,
  toOperation: (id) => ({ id, kind: "sequence.get" }),
  what: "Sequence for campaign",
});

export const senderList = (core: Core): ListSpec<Sender, SenderFilters> => ({
  action: "senders.list",
  keyOf: refOf,
  prepare: (filters) => {
    // Some vendors list senders only per campaign, so the scoped listing
    // does not depend on the unscoped one.
    if (filters.campaignId === undefined) {
      requireCapability(core.gate, "senders.list", "Listing senders");
    } else {
      requireCapability(
        core.gate,
        "senders.byCampaign",
        "Listing a campaign's senders"
      );
    }

    return { campaignId: filters.campaignId };
  },
  schema: senderSchema,
  toOperation: (filters, page) => ({
    kind: "senders.list",
    query: { ...filters, ...page },
  }),
});

export const senderGet = (core: Core): GetSpec<Sender> => ({
  action: "senders.get",
  prepare: () => {
    requireCapability(core.gate, "senders.get", "Reading one sender");
  },
  schema: senderSchema,
  toOperation: (id) => ({ id, kind: "senders.get" }),
  what: "Sender",
});

export const leadList = (core: Core): ListSpec<Lead, LeadFilters> => ({
  action: "leads.list",
  keyOf: refOf,
  prepare: (filters) => {
    if (filters.campaignId !== undefined && filters.listId !== undefined) {
      throw new OutboundError(
        "Invalid",
        "Leads can be listed by campaign or by list, not both at once"
      );
    }

    // Some vendors have no global lead list: leads exist only per campaign.
    if (filters.listId !== undefined) {
      requireCapability(core.gate, "lists.leads", "Listing a list's leads");
    } else if (filters.campaignId === undefined) {
      requireCapability(core.gate, "leads.list", "Listing leads");
    } else {
      requireCapability(
        core.gate,
        "leads.byCampaign",
        "Listing a campaign's leads"
      );
    }

    if (hasRange(filters)) {
      requireCapability(core.gate, "leads.since", "Filtering leads by date");
    }

    return {
      campaignId: filters.campaignId,
      listId: filters.listId,
      ...normalizeRange(filters),
    };
  },
  schema: leadSchema,
  toOperation: (filters, page) => ({
    kind: "leads.list",
    query: { ...filters, ...page },
  }),
});

export const leadGet = (core: Core): GetSpec<Lead> => ({
  action: "leads.get",
  prepare: () => {
    requireCapability(core.gate, "leads.get", "Reading one lead");
  },
  schema: leadSchema,
  toOperation: (id) => ({ id, kind: "leads.get" }),
  what: "Lead",
});

export const messageList = (core: Core): ListSpec<Message, MessageFilters> => ({
  action: "messages.list",
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(core.gate, "messages.list", "Listing messages");

    if (filters.threadId !== undefined) {
      requireCapability(
        core.gate,
        "messages.byThread",
        "Reading one conversation"
      );
    }

    if (wantsBody(filters.include)) {
      requireCapability(core.gate, "messages.body", "Reading message bodies");
    }

    if (hasRange(filters)) {
      requireCapability(
        core.gate,
        "messages.since",
        "Filtering messages by date"
      );
    }

    return {
      campaignId: filters.campaignId,
      include: filters.include,
      leadId: filters.leadId,
      threadId: filters.threadId,
      ...normalizeRange(filters),
    };
  },
  schema: messageSchema,
  toOperation: (filters, page) => ({
    kind: "messages.list",
    query: {
      campaignId: filters.campaignId,
      includeBody: wantsBody(filters.include),
      leadId: filters.leadId,
      since: filters.since,
      threadId: filters.threadId,
      until: filters.until,
      ...page,
    },
  }),
});

export const replyList = (core: Core): ListSpec<Reply, ReplyFilters> => ({
  action: "replies.list",
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(core.gate, "replies.list", "Listing replies");

    if (filters.category !== undefined) {
      requireCapability(
        core.gate,
        "replies.category",
        "Filtering replies by category"
      );
    }

    if (wantsBody(filters.include)) {
      requireCapability(core.gate, "messages.body", "Reading reply bodies");
    }

    if (hasRange(filters)) {
      requireCapability(
        core.gate,
        "replies.since",
        "Filtering replies by date"
      );
    }

    return {
      campaignId: filters.campaignId,
      category: filters.category,
      include: filters.include,
      ...normalizeRange(filters),
    };
  },
  schema: replySchema,
  toOperation: (filters, page) => ({
    kind: "replies.list",
    query: {
      campaignId: filters.campaignId,
      category: filters.category,
      includeBody: wantsBody(filters.include),
      since: filters.since,
      until: filters.until,
      ...page,
    },
  }),
});

export const workspaceList = (
  core: Core
): ListSpec<Workspace, Record<never, never>> => ({
  action: "workspaces.list",
  keyOf: refOf,
  prepare: () => {
    requireCapability(core.gate, "workspaces", "Listing workspaces");

    return {};
  },
  schema: workspaceSchema,
  toOperation: (_filters, page) => ({ kind: "workspaces.list", query: page }),
});
