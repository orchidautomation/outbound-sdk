// Every read the SDK makes is one of these operations. Plugins see and wrap
// them; the innermost step hands each one to the adapter.

import type {
  CampaignQuery,
  LeadQuery,
  MessageQuery,
  Page,
  PageQuery,
  ReplyQuery,
  SenderQuery,
  StatsQuery,
  TimeRange,
} from "../adapter.ts";
import type { Capabilities } from "../capabilities.ts";
import {
  idFor,
  optionalId,
  output,
  single,
  unsupported,
} from "./operation-shared.ts";
import type { DispatchTarget, OperationOutput } from "./operation-shared.ts";
import { dispatchAccount, isAccountOperation } from "./operations-account.ts";
import type { AccountOperation } from "./operations-account.ts";

export type {
  DispatchTarget,
  OperationOutput,
  OutboundRecord,
} from "./operation-shared.ts";

type CoreOperation =
  | { readonly kind: "campaigns.get"; readonly id: string }
  | { readonly kind: "campaigns.list"; readonly query: CampaignQuery }
  | { readonly kind: "leads.get"; readonly id: string }
  | { readonly kind: "leads.list"; readonly query: LeadQuery }
  | { readonly kind: "messages.list"; readonly query: MessageQuery }
  | { readonly kind: "replies.list"; readonly query: ReplyQuery }
  | { readonly kind: "senders.get"; readonly id: string }
  | { readonly kind: "senders.list"; readonly query: SenderQuery }
  | { readonly kind: "sequence.get"; readonly id: string }
  | { readonly kind: "stats"; readonly query: StatsQuery }
  | { readonly kind: "workspaces.list"; readonly query: PageQuery };

export type Operation = AccountOperation | CoreOperation;

export type OperationKind = Operation["kind"];

const inRange = (value: string | null, range: TimeRange): boolean => {
  if (range.since === undefined && range.until === undefined) {
    return true;
  }

  if (value === null) {
    return false;
  }

  const time = Date.parse(value);

  return (
    (range.since === undefined || time >= Date.parse(range.since)) &&
    (range.until === undefined || time <= Date.parse(range.until))
  );
};

const hasRange = (range: TimeRange): boolean =>
  range.since !== undefined || range.until !== undefined;

interface Filtered<Item> {
  readonly page: Page<Item>;
  readonly derived: boolean;
}

// When the vendor cannot filter by date, the wrapper filters after fetching
// and marks the result as derived. Leads are filtered on `createdAt`, so a
// lead changed after `since` but created before it is left out.
const filterByTime = <Item>(
  page: Page<Item>,
  range: TimeRange,
  grade: Capabilities["leads.since"],
  timeOf: (item: Item) => string | null
): Filtered<Item> => {
  if (grade !== "client" || !hasRange(range)) {
    return { derived: false, page };
  }

  return {
    derived: true,
    page: {
      items: page.items.filter((item) => inRange(timeOf(item), range)),
      next: page.next,
    },
  };
};

const listCampaigns = async (
  target: DispatchTarget,
  query: CampaignQuery
): Promise<OperationOutput> => {
  const page = await target.adapter.listCampaigns(
    { ...query, senderId: optionalId(target.adapter, query.senderId) },
    target.ctx
  );

  if (
    target.capabilities["campaigns.status"] !== "client" ||
    query.status === undefined
  ) {
    return output(page);
  }

  return output(
    {
      items: page.items.filter((campaign) => campaign.status === query.status),
      next: page.next,
    },
    true
  );
};

const listLeads = async (
  target: DispatchTarget,
  query: LeadQuery
): Promise<OperationOutput> => {
  const { adapter, capabilities, ctx } = target;

  if (adapter.listLeads === undefined) {
    throw unsupported(adapter, "leads.list");
  }

  const page = await adapter.listLeads(
    {
      ...query,
      campaignId: optionalId(adapter, query.campaignId),
      listId: optionalId(adapter, query.listId),
    },
    ctx
  );

  const filtered = filterByTime(
    page,
    query,
    capabilities["leads.since"],
    (lead) => lead.createdAt
  );

  return output(filtered.page, filtered.derived);
};

const listMessages = async (
  target: DispatchTarget,
  query: MessageQuery
): Promise<OperationOutput> => {
  const { adapter, capabilities, ctx } = target;

  if (adapter.listMessages === undefined) {
    throw unsupported(adapter, "messages.list");
  }

  const page = await adapter.listMessages(
    {
      ...query,
      campaignId: optionalId(adapter, query.campaignId),
      leadId: optionalId(adapter, query.leadId),
    },
    ctx
  );

  const filtered = filterByTime(
    page,
    query,
    capabilities["messages.since"],
    (message) => message.sentAt
  );

  return output(filtered.page, filtered.derived);
};

const listReplies = async (
  target: DispatchTarget,
  query: ReplyQuery
): Promise<OperationOutput> => {
  const { adapter, capabilities, ctx } = target;

  if (adapter.listReplies === undefined) {
    throw unsupported(adapter, "replies.list");
  }

  const page = await adapter.listReplies(
    { ...query, campaignId: optionalId(adapter, query.campaignId) },
    ctx
  );

  const filtered = filterByTime(
    page,
    query,
    capabilities["replies.since"],
    (reply) => reply.sentAt
  );

  // A vendor that reports the flag but cannot filter by it: the wrapper
  // keeps the replies that match, and a reply that does not say is dropped.
  if (
    capabilities["replies.unread"] !== "client" ||
    query.unread === undefined
  ) {
    return output(filtered.page, filtered.derived);
  }

  return output(
    {
      items: filtered.page.items.filter(
        (reply) => reply.unread === query.unread
      ),
      next: filtered.page.next,
    },
    true
  );
};

const listSenders = async (
  target: DispatchTarget,
  query: SenderQuery
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;

  if (adapter.listSenders === undefined) {
    throw unsupported(adapter, "senders.list");
  }

  return output(
    await adapter.listSenders(
      { ...query, campaignId: optionalId(adapter, query.campaignId) },
      ctx
    )
  );
};

const stats = async (
  target: DispatchTarget,
  query: StatsQuery
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;

  if (adapter.stats === undefined) {
    throw unsupported(adapter, "stats");
  }

  const rows = await adapter.stats(
    {
      ...query,
      scopeId: optionalId(adapter, query.scopeId),
      scopeIds:
        query.scopeIds === undefined
          ? undefined
          : [...new Set(query.scopeIds.map((id) => idFor(adapter, id)))],
    },
    ctx
  );

  const derived = rows.some((row) => row.evidence !== "exact");

  return { evidence: derived ? "derived" : "exact", items: rows };
};

const getOne = async (
  target: DispatchTarget,
  operation: Extract<CoreOperation, { readonly id: string }>
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;
  const id = idFor(adapter, operation.id);

  switch (operation.kind) {
    case "campaigns.get": {
      return single(await adapter.getCampaign(id, ctx));
    }

    case "leads.get": {
      if (adapter.getLead === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return single(await adapter.getLead(id, ctx));
    }

    case "senders.get": {
      if (adapter.getSender === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return single(await adapter.getSender(id, ctx));
    }

    case "sequence.get": {
      if (adapter.getSequence === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return single(await adapter.getSequence(id, ctx));
    }

    default: {
      const unreachable: never = operation;

      return unreachable;
    }
  }
};

/** The innermost step: hands one operation to the adapter. */
export const dispatch = async (
  target: DispatchTarget,
  operation: Operation
): Promise<OperationOutput> => {
  if (isAccountOperation(operation)) {
    return await dispatchAccount(target, operation);
  }

  switch (operation.kind) {
    case "campaigns.list": {
      return await listCampaigns(target, operation.query);
    }

    case "leads.list": {
      return await listLeads(target, operation.query);
    }

    case "messages.list": {
      return await listMessages(target, operation.query);
    }

    case "replies.list": {
      return await listReplies(target, operation.query);
    }

    case "senders.list": {
      return await listSenders(target, operation.query);
    }

    case "stats": {
      return await stats(target, operation.query);
    }

    case "workspaces.list": {
      if (target.adapter.listWorkspaces === undefined) {
        throw unsupported(target.adapter, operation.kind);
      }

      return output(
        await target.adapter.listWorkspaces(operation.query, target.ctx)
      );
    }

    default: {
      return await getOne(target, operation);
    }
  }
};
