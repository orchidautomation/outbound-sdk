// dropped_replies: replies nobody answered.

import { z } from "zod";

import type { Campaign, Lead, Reply } from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { replyCategorySchema } from "../../internal/vocabulary.ts";
import type { Capped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { inboxOf } from "../inbox.ts";
import { check, HOUR, sentByHand } from "./dropped-replies-check.ts";
import type {
  Conversation,
  DroppedReply,
  FoundDropped,
} from "./dropped-replies-check.ts";
import { nameOf, readByRef, readCappedFlag } from "./read.ts";
import { recordsMeetings, threadContext } from "./thread-context.ts";
import type { ThreadContext } from "./thread-context.ts";

const DAY = 24 * HOUR;

const DEFAULT_DAYS = 14;

/** The most replies read from one window when `max_replies` is not set. */
const WINDOW_REPLIES = 2000;

const input = z.object({
  categories: z
    .array(replyCategorySchema)
    .min(1)
    .default(["positive", "neutral", "unknown"])
    .describe(
      "Reply categories that need an answer. Out-of-office, bounce, unsubscribe and negative replies are left out by default."
    ),
  include_auto: z
    .boolean()
    .default(false)
    .describe(
      "Also check replies flagged automatic (by the vendor or a fixed rule) and list conversations ending in an automatic reply."
    ),
  include_inbox: z
    .boolean()
    .default(false)
    .describe(
      "Also check replies outside every campaign, such as HeyReach inbox messages. false counts them in totals.notInCampaign."
    ),
  max_replies: z
    .number()
    .int()
    .min(1)
    .max(WINDOW_REPLIES)
    .nullable()
    .default(null)
    .describe(
      "The most replies to read. Null reads every reply since `since`, up to 2,000."
    ),
  older_than_hours: z
    .number()
    .min(0)
    .default(24)
    .describe(
      "A reply counts as dropped only after waiting this many hours without an answer"
    ),
  since: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .nullable()
    .default(null)
    .describe(
      "Only replies received at or after this ISO 8601 time. Null means 14 days before now."
    ),
});

export interface DroppedReplies {
  /** Longest waiting first. */
  readonly dropped: readonly DroppedReply[];
  /**
   * The answer in one sentence, coverage first: how many conversations went
   * unchecked or how many replies were left unread, then what was found.
   * Never "none owed" from part of the data.
   */
  readonly finding: string;
  readonly totals: {
    readonly repliesRead: number;
    /** Left out for a category that needs no answer. */
    readonly skippedByCategory: number;
    /**
     * Left out because they are flagged automatic, by the vendor or by a fixed
     * rule, or because their conversation, read in full, ends in an automatic
     * reply. 0 with `include_auto`.
     */
    readonly skippedAuto: number;
    /**
     * Set aside because their conversation belongs to no campaign, such as a
     * LinkedIn account's own messages; 0 with `include_inbox`. `null` when the
     * vendor's replies are all campaign replies (no `replies.inbox`). Always
     * set by dropped_replies; optional so a value built by hand stays valid.
     */
    readonly notInCampaign?: number | null;
    /** Conversations the remaining replies belong to: answered, dropped, tooRecent and unchecked add up to it. */
    readonly conversations: number;
    readonly answered: number;
    /**
     * Conversations owed a reply, or `null` when any went unchecked or more
     * replies exist: the check is incomplete and `droppedFound` is only a
     * lower bound.
     */
    readonly dropped: number | null;
    /** Dropped conversations found among those checked. Checking more never lowers it. */
    readonly droppedFound: number;
    /** Unanswered, as far as was read, but waiting less than `older_than_hours`. */
    readonly tooRecent: number;
    /** Could not be checked: no thread or lead to read, a read that failed, or no time on the reply. Not counted as dropped. */
    readonly unchecked: number;
    /** `true` when `max_replies`, or the 2,000 replies one window reads, stopped the read with more replies left, so dropped ones may be missing. */
    readonly moreRepliesExist: boolean;
  };
  readonly since: string;
  readonly olderThanHours: number;
}

interface Readers {
  readonly thread: boolean;
  readonly timeline: boolean;
}

const readersOf = (context: InsightContext): Readers => {
  const { capabilities } = context.outbound;
  const messages = capabilities["messages.list"];

  return {
    thread: messages && capabilities["messages.byThread"],
    timeline: messages && capabilities["leads.timeline"],
  };
};

/** Groups replies by the conversation that can be read for them. */
const conversationsOf = (
  replies: readonly Reply[],
  readers: Readers
): Conversation[] => {
  const groups = new Map<string, Conversation>();

  for (const reply of replies) {
    const thread = readers.thread ? reply.threadId : null;
    const lead = readers.timeline ? reply.leadRef : null;
    const by = thread === null ? "timeline" : "thread";
    const id = thread ?? lead;

    const key = id === null ? `none:${reply.ref}` : `${by}:${id}`;

    const group = groups.get(key) ?? {
      by: id === null ? null : by,
      id: id ?? reply.ref,
      replies: [],
    };

    group.replies.push(reply);
    groups.set(key, group);
  }

  return [...groups.values()];
};

/** The finding: what went unchecked or unread first, then what was found. */
const overallOf = (totals: DroppedReplies["totals"]): string => {
  const {
    conversations,
    droppedFound: found,
    moreRepliesExist: capped,
    repliesRead,
    unchecked,
  } = totals;

  const owed = `${plural(found, "conversation")} owed a reply`;

  if (unchecked === 0 && !capped) {
    return `${owed}, of ${plural(conversations, "conversation")} checked in full.`;
  }

  const gaps = [
    ...(unchecked > 0
      ? [
          `${unchecked} of ${plural(conversations, "conversation")} could not be checked`,
        ]
      : []),
    ...(capped
      ? [
          `more replies exist past the ${plural(repliesRead, "reply", "replies")} read`,
        ]
      : []),
  ].join(" and ");

  return `${gaps}, so how many are owed is unknown and totals.dropped is null. Found ${owed} among the ${conversations - unchecked} checked, a lower bound.`;
};

const refsOf = (refs: readonly (string | null)[]): string[] => [
  ...new Set(refs.flatMap((ref) => (ref === null ? [] : [ref]))),
];

/** The finding, with what the latest message is and any meeting the vendor records. */
const findingOf = (
  finding: string,
  reply: string,
  found: ThreadContext
): string => {
  const [latest] = found.followUp.evidence;
  const latestIsReply = found.activity.latest?.ref === reply;

  const meeting =
    found.followUp.basis === "meeting"
      ? ` ${found.followUp.evidence.at(-1) ?? ""} Check it before following up.`
      : "";

  return latestIsReply || latest === undefined
    ? `${finding}${meeting}`
    : `${finding} ${latest} Read it before following up.${meeting}`;
};

/**
 * Fills in who is waiting and which campaign they are in, and the thread's
 * context: who wrote last, the meeting the vendor records and the follow-up
 * assessment. Reads only the leads and campaigns of the dropped replies.
 */
const named = async (
  context: InsightContext,
  dropped: readonly FoundDropped[]
): Promise<DroppedReply[]> => {
  const { outbound } = context;
  const readLeads = outbound.capabilities["leads.get"];
  const leadRefs = readLeads ? refsOf(dropped.map((each) => each.lead)) : [];

  if (!readLeads && dropped.length > 0) {
    context.note(
      "This tool cannot read one lead (leads.get), so name, email and linkedinUrl are null."
    );
  }

  const unlinked = dropped.filter((each) => each.lead === null).length;

  if (unlinked > 0) {
    context.note(
      `${unlinked} dropped ${unlinked === 1 ? "reply carries" : "replies carry"} no lead ref, since the vendor does not tie a reply to its lead, so name, email and linkedinUrl are null there.`
    );
  }

  const [leads, campaigns] = await Promise.all([
    readByRef<Lead>(
      context,
      leadRefs,
      (refs) => outbound.leads.getMany(refs),
      ["lead", "leads"],
      "names are null"
    ),
    readByRef<Campaign>(
      context,
      refsOf(dropped.map((each) => each.campaign)),
      (refs) => outbound.campaigns.getMany(refs),
      ["campaign", "campaigns"],
      "names are null"
    ),
  ]);

  return dropped.map(({ labelled, messages, ...each }) => {
    const lead = each.lead === null ? undefined : leads.get(each.lead);

    const campaign =
      each.campaign === null ? undefined : campaigns.get(each.campaign);

    const found = threadContext({
      labelled,
      lead: lead ?? null,
      meetingsRecorded: recordsMeetings(outbound),
      messages,
      now: context.now,
      provider: each.provider,
    });

    return {
      ...each,
      ...found,
      campaignName: campaign?.name ?? null,
      email: lead?.email ?? null,
      finding: findingOf(each.finding, each.reply, found),
      linkedinUrl: lead?.linkedinUrl ?? null,
      name: lead === undefined ? null : nameOf(lead),
    };
  });
};

/**
 * The replies to check: every one, or with `includeInbox` false only those
 * in a campaign. `notInCampaign` counts the ones set aside, `null` where the
 * tool cannot tell an inbox reply apart.
 */
const inCampaigns = (
  context: InsightContext,
  inWindow: readonly Reply[],
  includeInbox: boolean
) => {
  const fromInbox = inboxOf(context.outbound);

  const separates =
    context.outbound.capabilities["replies.inbox"] || inWindow.some(fromInbox);

  const replies = includeInbox
    ? inWindow
    : inWindow.filter(
        (reply) => reply.campaignRef !== null || !fromInbox(reply)
      );

  const setAside = inWindow.length - replies.length;

  if (setAside > 0) {
    context.note(
      `${plural(setAside, "reply", "replies")} in conversations that belong to no campaign, such as a LinkedIn account's own messages on HeyReach, ${setAside === 1 ? "was" : "were"} set aside and counted in totals.notInCampaign. Pass include_inbox: true to check them.`
    );
  }

  return { notInCampaign: separates ? setAside : null, replies };
};

const readReplies = (
  context: InsightContext,
  since: string,
  given: number | null
): Promise<Capped<Reply>> => {
  const { outbound } = context;
  const filtered = outbound.capabilities["replies.since"] !== false;

  if (!filtered) {
    context.note(
      "This tool cannot filter replies by date, so the newest replies were read and filtered here."
    );
  }

  // Replies outside every campaign are read too, so they can be counted
  // when they are set aside. A tool with no such inbox reads the same either
  // way, and on a combined instance each tool that has one includes it.
  return readCappedFlag(
    context,
    (cap) =>
      outbound.replies.listAll(
        filtered
          ? { includeInbox: true, max: cap, since }
          : { includeInbox: true, max: cap }
      ),
    given ?? WINDOW_REPLIES,
    "replies",
    given === null
      ? "the most one window reads; pass a later since"
      : "max_replies"
  );
};

export const droppedReplies = defineInsight({
  description:
    "Replies from prospects that nobody answered: a reply in a category that needs an answer, with nothing sent after it for longer than older_than_hours. Returns them longest waiting first, with hours waiting, category, campaign and lead, plus who wrote last, any meeting the vendor records and a fixed-rule follow-up assessment. Read the latest message with thread_context before following up. Costs one request per page of replies, one per conversation read in full, and one per lead and campaign it names.",
  inputSchema: input,
  key: "droppedReplies",
  cost: (values, price) => {
    const most = values.max_replies ?? WINDOW_REPLIES;

    return (
      price.list("replies.list", most) +
      (price.capabilities["messages.byHand"]
        ? price.upTo(price.list("messages.list", most))
        : 0) +
      price.upTo(most) *
        (price.walk("messages.list") +
          (price.capabilities["leads.get"] === false
            ? 0
            : price.one("leads.get")) +
          price.one("campaigns.get"))
    );
  },
  scales: "max_replies",
  name: "dropped_replies",
  needs: ["replies.list"],
  next: "Use thread_context with the dropped replies' lead refs to read the latest messages before answering. Use hot_leads to see who else to contact first.",
  run: async (context, values) => {
    const since = new Date(
      values.since === null
        ? context.now - DEFAULT_DAYS * DAY
        : Date.parse(values.since)
    ).toISOString();

    const readers = readersOf(context);

    if (!(readers.thread || readers.timeline)) {
      context.note(
        "This tool can read neither a conversation nor a lead's timeline, so no reply could be checked."
      );
    }

    const listed = await readReplies(context, since, values.max_replies);

    const read = listed.items;

    // A reply with no time is kept: it is counted as unchecked below.
    const inWindow = read.filter(
      (reply) =>
        reply.sentAt === null || Date.parse(reply.sentAt) >= Date.parse(since)
    );

    const { notInCampaign, replies } = inCampaigns(
      context,
      inWindow,
      values.include_inbox
    );

    const wanted = replies.filter((reply) =>
      values.categories.includes(reply.category)
    );

    const kept = wanted.filter(
      (reply) => values.include_auto || reply.isAuto !== true
    );

    const conversations = conversationsOf(kept, readers);

    // A conversation with no reader or no timed reply cannot be checked.
    const checkable = conversations.flatMap((conversation) =>
      conversation.by !== null &&
      conversation.replies.some((each) => each.sentAt !== null)
        ? [{ ...conversation, by: conversation.by }]
        : []
    );

    const unchecked = conversations.length - checkable.length;

    const sent =
      checkable.length === 0
        ? null
        : await sentByHand(
            context,
            since,
            values.max_replies ?? WINDOW_REPLIES
          );

    const {
      answered,
      automatic,
      automaticReplies,
      dropped,
      tooRecent,
      unread,
    } = await check(
      context,
      checkable,
      sent,
      values.older_than_hours,
      values.include_auto
    );

    const withNames = await named(context, dropped);
    const notChecked = unchecked + unread;
    const owedOrUnknown = conversations.length - automatic;

    if (notChecked > 0) {
      context.partial(
        notChecked === owedOrUnknown
          ? `None of the ${plural(notChecked, "conversation")} could be checked, so totals.dropped is null and droppedFound counts none of them. totals.unchecked counts them, as neither dropped nor answered.`
          : `${plural(notChecked, "conversation")} of ${owedOrUnknown} could not be checked, so totals.dropped is null and droppedFound counts only the ${owedOrUnknown - notChecked} that were. totals.unchecked counts the rest, as neither dropped nor answered.`
      );
    }

    const totals: DroppedReplies["totals"] = {
      answered,
      conversations: owedOrUnknown,
      dropped: notChecked === 0 && !listed.capped ? dropped.length : null,
      droppedFound: dropped.length,
      moreRepliesExist: listed.capped,
      notInCampaign,
      repliesRead: read.length,
      skippedAuto: wanted.length - kept.length + automaticReplies,
      skippedByCategory: replies.length - wanted.length,
      tooRecent,
      unchecked: notChecked,
    };

    const answer: DroppedReplies = {
      dropped: withNames.toSorted(
        (left, right) =>
          right.hoursWaiting - left.hoursWaiting ||
          left.reply.localeCompare(right.reply)
      ),
      finding: overallOf(totals),
      olderThanHours: values.older_than_hours,
      since,
      totals,
    };

    return answer;
  },
});
