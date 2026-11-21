// dropped_replies' listings of answers: one listing per tool that settles
// each answered conversation without reading it.

import type { Message } from "../../internal/entities.ts";
import type { OutboundApi } from "../../internal/outbound/api.ts";
import type { InsightContext } from "../define.ts";

export interface ListedAnswers {
  readonly messages: readonly Message[];
  /** The ones listed as the latest message of their conversation. */
  readonly latest: readonly Message[];
  /** `false` when the listing stopped at its max with more left. */
  readonly whole: boolean;
}

type AnswerFilter =
  | { readonly latestOfConversation: true }
  | { readonly byHand: true };

/** The listing that settles conversations on one tool, or `null` where it has none it can filter by date on its side. */
const answerFilter = (outbound: OutboundApi): AnswerFilter | null => {
  const { capabilities } = outbound;

  if (capabilities["messages.since"] !== "server") {
    return null;
  }

  if (capabilities["messages.latestOfConversation"]) {
    return { latestOfConversation: true };
  }

  return capabilities["messages.byHand"] ? { byHand: true } : null;
};

/**
 * Each tool's listing: the instance's own, or on a combined instance whose
 * tools do not all have one, each tool that has. A combined instance lists
 * its tools with no request.
 */
const answerListings = async (context: InsightContext) => {
  const { outbound } = context;
  const own = answerFilter(outbound);

  if (own !== null || outbound.provider !== "combined") {
    return own === null ? [] : [{ filter: own, outbound }];
  }

  const tools = await context.all(outbound.workspaces.listAll());

  return tools.flatMap((tool) => {
    const one = outbound.workspace(`${tool.provider}:${tool.workspaceId}`);
    const filter = answerFilter(one);

    return filter === null ? [] : [{ filter, outbound: one }];
  });
};

/**
 * Listings since `since`, up to `max` each, that settle conversations
 * without reading each: the latest message of every conversation holding a
 * reply where a tool can list that, else the messages sent by hand. One
 * request per page, and `null` where no tool can list either by date on
 * its side. Only an answer is read from them, so stopping at `max` leaves
 * the rest to be read by thread and loses nothing.
 */
export const listedAnswers = async (
  context: InsightContext,
  since: string,
  max: number
): Promise<ListedAnswers | null> => {
  const listings = await answerListings(context);

  if (listings.length === 0) {
    return null;
  }

  // Its cost is counted, but a stop at `max` does not make the answer partial.
  // A request cap that stops it leaves every conversation to be read in full.
  const walks = listings.map(({ filter, outbound }) => ({
    latest: "latestOfConversation" in filter,
    walk: outbound.messages.listAll({ ...filter, max, since }),
    what:
      "latestOfConversation" in filter
        ? "latest messages of each conversation"
        : "messages sent by hand",
  }));

  const found = await context.each(
    walks,
    async ({ walk }) => await walk.toArray(),
    "listings of answers"
  );

  if (found.length < walks.length) {
    return null;
  }

  for (const { walk, what } of walks) {
    if (walk.meta !== undefined) {
      context.one({ meta: walk.meta });
    }

    if (walk.truncated) {
      context.note(
        `The ${what} stopped at ${max}, so each conversation they did not settle was read in full.`
      );
    }
  }

  return {
    latest: found.flatMap((items, index) =>
      walks[index]?.latest === true ? items : []
    ),
    messages: found.flat(),
    whole: walks.every(({ walk }) => !walk.truncated),
  };
};
