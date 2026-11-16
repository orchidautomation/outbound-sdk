// Capped reads every insight shares: a listing read up to a cap the caller
// set, whose note names the input that raises it, and the campaigns in some
// states up to one cap across all of them.

import type { Campaign, CampaignStatus } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { ListAll, PageResult } from "../internal/outbound/api.ts";
import type { InsightContext } from "./define.ts";
import { capNote, wasCutShort } from "./tracked-reads.ts";
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

    return { capped: walk.truncated || wasCutShort(items), items };
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

/** The page, or `null` when a request cap stopped it. */
const settledPage = async <Item>(
  read: Promise<PageResult<Item>>
): Promise<PageResult<Item> | null> => {
  try {
    return await read;
  } catch (error) {
    if (
      OutboundError.is(error) &&
      error.code === "RateLimited" &&
      (error.limit === "call" || error.limit === "run")
    ) {
      return null;
    }

    throw error;
  }
};

const either = (words: readonly string[]): string =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;

/**
 * When no campaign is in the states asked for but the workspace has others,
 * the answer covers nothing, so it is marked incomplete with a note counting
 * them, instead of reading as a clean run with nothing found.
 */
const noneMatched = (
  context: InsightContext,
  wanted: readonly CampaignStatus[],
  others: readonly Campaign[],
  more: boolean
): void => {
  if (others.length === 0) {
    return;
  }

  const counts = new Map<string, number>();

  for (const campaign of others) {
    counts.set(campaign.status, (counts.get(campaign.status) ?? 0) + 1);
  }

  const byStatus = [...counts]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");

  const total = `${more ? "the first " : ""}${others.length} campaign${others.length === 1 ? "" : "s"}`;

  context.partial(
    `No campaign is ${either(wanted)}, so nothing was checked (${total}: ${byStatus}). Pass statuses to check the others.`
  );
};

/**
 * Campaigns in the states asked for, and every campaign when the read had
 * to list them all to filter by state.
 */
interface CampaignsIn extends Capped<Campaign> {
  readonly every?: readonly Campaign[];
}

/**
 * When the read found no campaign in the states asked for and nothing was
 * left unread, counts the others: from the campaigns already listed when
 * there are any, otherwise from one page of the listing.
 */
const countOthers = async (
  context: InsightContext,
  wanted: readonly CampaignStatus[],
  every: readonly Campaign[] | undefined
): Promise<void> => {
  if (every !== undefined) {
    noneMatched(context, wanted, every, false);

    return;
  }

  const page = await settledPage(context.outbound.campaigns.list());

  if (page === null) {
    context.partial(
      `No campaign is ${either(wanted)}, so nothing was checked; a request cap stopped the count of the others.`
    );

    return;
  }

  noneMatched(context, wanted, context.page(page), page.cursor !== undefined);
};

/**
 * How `max` is shared among tools that have `counts` campaigns each: the
 * tools with fewer than an even share keep all theirs, and the rest split
 * what they leave evenly.
 */
const fairShares = (counts: readonly number[], max: number): number[] => {
  const shares = counts.map(() => 0);
  let left = max;

  const order = counts
    .map((_, index) => index)
    .toSorted((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));

  for (const [at, index] of order.entries()) {
    const share = Math.min(
      counts[index] ?? 0,
      Math.floor(left / (order.length - at))
    );

    shares[index] = share;
    left -= share;
  }

  return shares;
};

/**
 * The campaigns in the given states of one tool, up to `cap.max`. Asks the
 * vendor per state when it can filter, and filters after reading when it
 * cannot, so there the cap counts every campaign read. A state read after
 * the cap is reached still asks for its first page, so campaigns left out
 * are reported instead of silently dropped.
 */
const readOne = async (
  context: InsightContext,
  wanted: readonly CampaignStatus[],
  cap: Cap
): Promise<CampaignsIn> => {
  const { campaigns } = context.outbound;

  if (context.outbound.capabilities["campaigns.status"] === false) {
    const every = await readCapped(
      context,
      (room) => campaigns.listAll({ max: room }),
      cap
    );

    const items = every.items.filter((campaign) =>
      wanted.includes(campaign.status)
    );

    return { capped: every.capped, every: every.items, items };
  }

  const found: Campaign[] = [];
  let capped = false;

  for (const status of wanted) {
    // oxlint-disable-next-line no-await-in-loop -- each status reads only the room the earlier ones left under the cap.
    const listed = await readCapped(
      context,
      (room) => campaigns.listAll({ max: room, status }),
      cap,
      cap.max - found.length
    );

    found.push(...listed.items);
    capped ||= listed.capped;
  }

  return { capped, items: found };
};

/**
 * On a combined instance, each tool is read on its own, up to `cap.max`,
 * and the cap is then shared among them, so a tool with many campaigns
 * cannot take every place before another tool is read.
 */
const readShared = async (
  context: InsightContext,
  wanted: readonly CampaignStatus[],
  cap: Cap
): Promise<CampaignsIn> => {
  const { outbound } = context;
  const tools = await context.all(outbound.workspaces.listAll());

  const read = await Promise.all(
    tools.map(async (tool) => {
      const label = `${tool.provider}:${tool.workspaceId}`;

      return {
        label,
        read: await readOne(
          { ...context, outbound: outbound.workspace(label) },
          wanted,
          cap
        ),
      };
    })
  );

  const shares = fairShares(
    read.map((each) => each.read.items.length),
    cap.max
  );

  const items = read.flatMap((each, index) =>
    each.read.items.slice(0, shares[index])
  );

  const dropped = read.some(
    (each, index) => each.read.items.length > (shares[index] ?? 0)
  );

  if (dropped) {
    context.partial(capNote(cap));
    context.note(
      `${cap.input ?? "The cap"} is shared among the tools: ${read.map((each, index) => `${each.label} ${shares[index] ?? 0}`).join(", ")}.`
    );
  }

  return {
    capped: dropped || read.some((each) => each.read.capped),
    items,
  };
};

/**
 * The campaigns in the given states, up to `max` in all. On a combined
 * instance `max` is shared among its tools, so each gets its share.
 */
export const readCampaignsIn = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number,
  input = "max_campaigns"
): Promise<Capped<Campaign>> => {
  const wanted = [...new Set(statuses)];
  const cap: Cap = { input, max, what: "campaigns" };

  const read =
    context.outbound.provider === "combined"
      ? await readShared(context, wanted, cap)
      : await readOne(context, wanted, cap);

  context.campaignsFound(read.items.length);

  if (read.items.length === 0 && !read.capped) {
    await countOthers(context, wanted, read.every);
  }

  return { capped: read.capped, items: read.items };
};
