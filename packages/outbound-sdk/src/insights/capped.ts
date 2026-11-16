// Capped reads every insight shares: a listing read up to a cap the caller
// set, whose note names the input that raises it, and the campaigns in some
// states up to one cap across all of them.

import type { Campaign, CampaignStatus } from "../internal/entities.ts";
import type { ListAll } from "../internal/outbound/api.ts";
import type { InsightContext } from "./define.ts";
import { capNote } from "./tracked-reads.ts";
import type { Cap } from "./tracked-reads.ts";

export interface Capped<Item> {
  readonly items: Item[];
  /** `true` when the cap stopped the read with more records left. */
  readonly capped: boolean;
}

/**
 * Reads up to `room` records, which is the cap unless less is left under it,
 * and says so in a note naming the cap's input when more exist.
 */
export const readCapped = async <Item>(
  context: InsightContext,
  open: (max: number) => ListAll<Item>,
  cap: Cap,
  room = cap.max
): Promise<Capped<Item>> => {
  if (room >= 1) {
    const walk = open(room);
    const items = await context.all(walk, cap);

    return { capped: walk.truncated, items };
  }

  // No room left: `max` must be at least 1, so read one record to learn
  // whether any were left out, and keep none. With two or more left, `all`
  // already notes the cap.
  const probe = open(1);
  const left = await context.all(probe, cap);

  if (left.length > 0 && !probe.truncated) {
    context.partial(capNote(cap));
  }

  return { capped: left.length > 0, items: [] };
};

/** How many campaigns an insight read, and whether its cap left some unread. */
export interface CampaignsRead {
  /** Campaigns read, in the states asked for. */
  readonly campaignsRead: number;
  /** `true` when `max_campaigns` stopped the read with more campaigns left. */
  readonly moreCampaignsExist: boolean;
}

export const campaignsReadOf = (read: Capped<Campaign>): CampaignsRead => ({
  campaignsRead: read.items.length,
  moreCampaignsExist: read.capped,
});

/**
 * The campaigns in the given states, up to `max` in all. Asks the vendor per
 * state when it can filter, and filters after reading when it cannot, so
 * there the cap counts every campaign read. A state read after the cap is
 * reached still asks for its first page, so campaigns left out are reported
 * instead of silently dropped.
 */
export const readCampaignsIn = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number,
  input = "max_campaigns"
): Promise<Capped<Campaign>> => {
  const { campaigns } = context.outbound;
  const wanted = [...new Set(statuses)];
  const cap: Cap = { input, max, what: "campaigns" };

  if (context.outbound.capabilities["campaigns.status"] === false) {
    const every = await readCapped(
      context,
      (room) => campaigns.listAll({ max: room }),
      cap
    );

    const items = every.items.filter((campaign) =>
      wanted.includes(campaign.status)
    );

    context.campaignsFound(items.length);

    return { capped: every.capped, items };
  }

  const found: Campaign[] = [];
  let capped = false;

  for (const status of wanted) {
    // oxlint-disable-next-line no-await-in-loop -- each status reads only the room the earlier ones left under the cap.
    const listed = await readCapped(
      context,
      (room) => campaigns.listAll({ max: room, status }),
      cap,
      max - found.length
    );

    found.push(...listed.items);
    capped ||= listed.capped;
  }

  context.campaignsFound(found.length);

  return { capped, items: found };
};
