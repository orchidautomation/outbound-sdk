// Every read the SDK makes is one of these operations. Plugins see and wrap
// them; the innermost step hands each one to the adapter.

import type {
  Adapter,
  AdapterContext,
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
import type { Entity, Evidence, MetricRow } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
import { sourceIdFor } from "../ref.ts";

export type Operation =
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

export type OperationKind = Operation["kind"];

/** A record an operation returns. */
export type OutboundRecord = Entity | MetricRow;

export interface OperationOutput {
  readonly items: readonly OutboundRecord[];
  /** The adapter's continuation value, when there is another page. */
  readonly next?: Json | undefined;
  readonly evidence: Evidence;
  /** `true` when a plugin served an older answer because the vendor was down. */
  readonly stale?: boolean | undefined;
}

const unsupported = (adapter: Adapter, kind: OperationKind): OutboundError =>
  new OutboundError(
    "Unsupported",
    `The ${adapter.name} adapter does not implement ${kind}`,
    {
      provider: adapter.name,
    }
  );

const idFor = (adapter: Adapter, id: string): string =>
  // A combined adapter routes by ref, so it needs the id untouched.
  adapter.members === undefined
    ? sourceIdFor(id, adapter.name, adapter.workspaceId)
    : id;

const optionalId = (
  adapter: Adapter,
  id: string | undefined
): string | undefined => (id === undefined ? undefined : idFor(adapter, id));

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
// and marks the result as derived.
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

const output = (
  page: Page<OutboundRecord>,
  derived = false
): OperationOutput => ({
  evidence: derived ? "derived" : "exact",
  items: page.items,
  next: page.next,
});

const single = (item: OutboundRecord): OperationOutput => ({
  evidence: "exact",
  items: [item],
});

export interface DispatchTarget {
  readonly adapter: Adapter;
  readonly capabilities: Capabilities;
  readonly ctx: AdapterContext;
}

const listCampaigns = async (
  target: DispatchTarget,
  query: CampaignQuery
): Promise<OperationOutput> => {
  const page = await target.adapter.listCampaigns(query, target.ctx);

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
    { ...query, campaignId: optionalId(adapter, query.campaignId) },
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

  return output(filtered.page, filtered.derived);
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
    { ...query, scopeId: optionalId(adapter, query.scopeId) },
    ctx
  );

  const derived = rows.some((row) => row.evidence !== "exact");

  return { evidence: derived ? "derived" : "exact", items: rows };
};

const getOne = async (
  target: DispatchTarget,
  operation: Extract<Operation, { readonly id: string }>
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
