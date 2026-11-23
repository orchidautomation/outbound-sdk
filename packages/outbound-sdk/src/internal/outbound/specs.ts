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
import { isString } from "../json.ts";
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

/** A bare domain such as `acme.com`: no scheme, address, path or port. */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;

const wantsBody = (include: readonly Include[] | undefined): boolean =>
  include?.includes("body") ?? false;

const hasRange = (filters: {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}) => filters.since !== undefined || filters.until !== undefined;

const refOf = (item: { readonly ref: string }): string => item.ref;

/** A text filter trimmed, refused when it holds nothing a record could match. */
const filterText = (
  value: string | undefined,
  name: string
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = isString(value) ? value.trim() : "";

  if (trimmed === "") {
    throw new OutboundError(
      "Invalid",
      `campaigns.list: ${name} must be a non-empty string`
    );
  }

  return trimmed;
};

export const campaignList = (
  core: Core
): ListSpec<Campaign, CampaignFilters> => ({
  action: "campaigns.list",
  takes: { name: true, senderId: true, status: true, tag: true },
  keyOf: refOf,
  prepare: (filters) => {
    const name = filterText(filters.name, "name");
    const tag = filterText(filters.tag, "tag");

    if (name !== undefined) {
      requireCapability(
        core.gate,
        "campaigns.byName",
        "Filtering campaigns by name"
      );
    }

    if (tag !== undefined) {
      requireCapability(
        core.gate,
        "campaigns.byTag",
        "Filtering campaigns by tag"
      );
    }

    if (filters.status !== undefined) {
      requireCapability(
        core.gate,
        "campaigns.status",
        "Filtering campaigns by status"
      );
    }

    if (filters.senderId !== undefined) {
      requireCapability(
        core.gate,
        "campaigns.bySender",
        "Listing a sender's campaigns"
      );
    }

    return { name, senderId: filters.senderId, status: filters.status, tag };
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
  takes: { campaignId: true },
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

/** The `emails` filter, lowercased and checked. Needs `leads.lookupMany`. */
const manyAddresses = (
  core: Core,
  given: readonly string[] | undefined
): string[] | undefined => {
  if (given === undefined) {
    return undefined;
  }

  requireCapability(
    core.gate,
    "leads.lookupMany",
    "Finding the leads of many email addresses at once"
  );

  const emails = given.map((each) => each.trim().toLowerCase());

  if (emails.length === 0 || emails.some((each) => !each.includes("@"))) {
    throw new OutboundError(
      "Invalid",
      "emails must list at least one email address, and only addresses"
    );
  }

  return emails;
};

/** The `interest` filter, which takes `positive` only. Needs `leads.byInterest`. */
const checkInterest = (core: Core, interest: string | undefined): void => {
  if (interest === undefined) {
    return;
  }

  requireCapability(
    core.gate,
    "leads.byInterest",
    "Listing only the leads labelled positive"
  );

  if (interest !== "positive") {
    throw new OutboundError(
      "Invalid",
      `interest takes "positive", not "${interest}"`
    );
  }
};

/** The `status` filter, which takes `active` only. Needs `leads.byStatus`. */
const checkStatus = (
  core: Core,
  filters: Pick<LeadFilters, "interest" | "status">
): void => {
  if (filters.status === undefined) {
    return;
  }

  requireCapability(
    core.gate,
    "leads.byStatus",
    "Listing only the active leads"
  );

  if (filters.status !== "active") {
    throw new OutboundError(
      "Invalid",
      `status takes "active", not "${String(filters.status)}"`
    );
  }

  if (filters.interest !== undefined) {
    throw new OutboundError(
      "Invalid",
      "Leads can be listed by interest or by status, not both at once"
    );
  }
};

export const leadList = (core: Core): ListSpec<Lead, LeadFilters> => ({
  action: "leads.list",
  takes: {
    campaignId: true,
    domain: true,
    email: true,
    emails: true,
    interest: true,
    linkedinUrl: true,
    listId: true,
    since: true,
    status: true,
    until: true,
  },
  // A lookup returns one record per campaign the person is in. On a vendor
  // whose lead id is the same in every campaign those records share a ref,
  // so the campaign is part of what tells them apart.
  keyOf: (lead, filters) =>
    filters.email === undefined &&
    filters.emails === undefined &&
    filters.linkedinUrl === undefined &&
    filters.domain === undefined
      ? lead.ref
      : `${lead.ref} ${lead.campaignRef ?? ""}`,
  prepare: (filters) => {
    if (filters.campaignId !== undefined && filters.listId !== undefined) {
      throw new OutboundError(
        "Invalid",
        "Leads can be listed by campaign or by list, not both at once"
      );
    }

    const lookup =
      filters.email !== undefined || filters.linkedinUrl !== undefined;

    if (lookup) {
      requireCapability(
        core.gate,
        "leads.lookup",
        "Finding a lead by email or LinkedIn profile"
      );
    }

    const emails = manyAddresses(core, filters.emails);

    checkInterest(core, filters.interest);
    checkStatus(core, filters);

    const domain = filters.domain?.trim().toLowerCase();

    if (domain !== undefined) {
      requireCapability(
        core.gate,
        "leads.byDomain",
        "Finding the leads at one email domain"
      );

      if (!DOMAIN.test(domain)) {
        throw new OutboundError(
          "Invalid",
          `"${filters.domain}" is not a domain such as acme.com`
        );
      }
    }

    // Some vendors have no global lead list: leads exist only per campaign.
    if (filters.listId !== undefined) {
      requireCapability(core.gate, "lists.leads", "Listing a list's leads");
    } else if (filters.campaignId !== undefined) {
      requireCapability(
        core.gate,
        "leads.byCampaign",
        "Listing a campaign's leads"
      );
    } else if (!lookup && domain === undefined && emails === undefined) {
      // A lookup by identifier or domain does not need the list of every lead.
      requireCapability(core.gate, "leads.list", "Listing leads");
    }

    if (hasRange(filters)) {
      requireCapability(core.gate, "leads.since", "Filtering leads by date");
    }

    return {
      campaignId: filters.campaignId,
      domain,
      email: filters.email?.trim().toLowerCase(),
      emails: emails === undefined ? undefined : [...new Set(emails)],
      interest: filters.interest,
      linkedinUrl: filters.linkedinUrl?.trim(),
      listId: filters.listId,
      status: filters.status,
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
  takes: {
    byHand: true,
    campaignId: true,
    include: true,
    latestOfConversation: true,
    leadId: true,
    since: true,
    threadId: true,
    until: true,
  },
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(core.gate, "messages.list", "Listing messages");

    if (filters.byHand !== undefined) {
      requireCapability(
        core.gate,
        "messages.byHand",
        "Listing only the messages sent by hand"
      );
    }

    if (filters.latestOfConversation !== undefined) {
      requireCapability(
        core.gate,
        "messages.latestOfConversation",
        "Listing only the latest message of each conversation"
      );
    }

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
      byHand: filters.byHand,
      campaignId: filters.campaignId,
      include: filters.include,
      latestOfConversation: filters.latestOfConversation,
      leadId: filters.leadId,
      threadId: filters.threadId,
      ...normalizeRange(filters),
    };
  },
  schema: messageSchema,
  toOperation: (filters, page) => ({
    kind: "messages.list",
    query: {
      byHand: filters.byHand,
      campaignId: filters.campaignId,
      includeBody: wantsBody(filters.include),
      latestOfConversation: filters.latestOfConversation,
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
  takes: {
    campaignId: true,
    category: true,
    include: true,
    includeInbox: true,
    since: true,
    unread: true,
    until: true,
  },
  keyOf: refOf,
  prepare: (filters) => {
    requireCapability(core.gate, "replies.list", "Listing replies");

    if (filters.includeInbox === true) {
      requireCapability(
        core.gate,
        "replies.inbox",
        "Listing replies in conversations that belong to no campaign"
      );
    }

    if (filters.category !== undefined) {
      requireCapability(
        core.gate,
        "replies.category",
        "Filtering replies by category"
      );
    }

    if (filters.unread !== undefined) {
      requireCapability(
        core.gate,
        "replies.unread",
        "Filtering replies by whether they are unread"
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
      includeInbox: filters.includeInbox,
      unread: filters.unread,
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
      includeInbox: filters.includeInbox,
      since: filters.since,
      unread: filters.unread,
      until: filters.until,
      ...page,
    },
  }),
});

export const workspaceList = (
  core: Core
): ListSpec<Workspace, Record<never, never>> => ({
  action: "workspaces.list",
  takes: {},
  keyOf: refOf,
  prepare: () => {
    requireCapability(core.gate, "workspaces", "Listing workspaces");

    return {};
  },
  schema: workspaceSchema,
  toOperation: (_filters, page) => ({ kind: "workspaces.list", query: page }),
});
