// What the in-memory adapter's readers share: the seeded data, paging and
// the lookup of one campaign.

import type { Page, PageQuery } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import type { Channel } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { isNumber } from "../internal/json.ts";
import type { Identity } from "../internal/record.ts";
import type { MemoryCampaign, MemoryData } from "./data.ts";

export const paginate = <Item>(
  items: readonly Item[],
  query: PageQuery,
  pageSize: number
): Page<Item> => {
  const offset = isNumber(query.next) ? query.next : 0;
  const size = Math.min(query.limit ?? pageSize, pageSize);
  const end = offset + size;

  return end < items.length
    ? { items: items.slice(offset, end), next: end }
    : { items: items.slice(offset, end) };
};

export const notFound = (
  provider: string,
  what: string,
  id: string
): OutboundError =>
  new OutboundError("NotFound", `${what} ${id} was not found`, {
    provider,
    status: 404,
  });

export interface Store {
  readonly identity: Identity;
  readonly data: MemoryData;
  readonly pageSize: number;
  readonly capabilities: CapabilityDeclaration;
  readonly channelOf: (campaignId: string | undefined) => Channel;
  /** Whether a campaign, a stats row, a lead, a message or a sender names this campaign id. */
  readonly mentionsCampaign: (campaignId: string | undefined) => boolean;
}

export const findCampaign = (store: Store, id: string): MemoryCampaign => {
  const seed = store.data.campaigns?.find((campaign) => campaign.id === id);

  if (seed === undefined) {
    throw notFound(store.identity.provider, "Campaign", id);
  }

  return seed;
};
