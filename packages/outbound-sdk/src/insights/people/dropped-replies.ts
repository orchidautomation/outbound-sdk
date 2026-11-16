// dropped_replies: replies nobody answered.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type {
  Campaign,
  Lead,
  Message,
  Reply,
} from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { replyCategorySchema } from "../../internal/vocabulary.ts";
import type { Capped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { round } from "../stats.ts";
import { nameOf, readByRef, readCappedFlag } from "./read.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A wait as a person says it: in hours under two days, in whole days after. */
const waited = (hours: number): string =>
  hours >= 48
    ? plural(Math.floor(hours / 24), "day")
    : plural(Math.floor(hours), "hour");

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
      "Set to true to also check replies flagged automatic, by the vendor or by a fixed rule"
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

export interface DroppedReply {
  /** The oldest reply in the conversation that got no answer. */
  readonly reply: string;
  readonly lead: string | null;
  /** The person's first and last name. `null` when the lead could not be read or has neither. */
  readonly name: string | null;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly campaign: string | null;
  /** The campaign's name. `null` when the reply names no campaign or it could not be read. */
  readonly campaignName: string | null;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
  readonly category: string;
  readonly subject: string | null;
  readonly receivedAt: string;
  readonly hoursWaiting: number;
  /** Replies in the conversation since the last message sent to the person. */
  readonly unansweredReplies: number;
  /** Whether the conversation was read by its thread or by the lead's timeline. */
  readonly checkedBy: "thread" | "timeline";
  readonly finding: string;
}

export interface DroppedReplies {
  /** Longest waiting first. */
  readonly dropped: readonly DroppedReply[];
  readonly totals: {
    readonly repliesRead: number;
    /** Left out for a category that needs no answer. */
    readonly skippedByCategory: number;
    /** Left out because they are flagged automatic, by the vendor or by a fixed rule. */
    readonly skippedAuto: number;
    /** Conversations the remaining replies belong to. */
    readonly conversations: number;
    readonly answered: number;
    readonly dropped: number;
    /** Unanswered, as far as was read, but waiting less than `older_than_hours`. */
    readonly tooRecent: number;
    /** Could not be checked: no thread or lead to read, or no time on the reply. Not counted as dropped. */
    readonly unchecked: number;
    /** `true` when `max_replies`, or the 2,000 replies one window reads, stopped the read with more replies left, so dropped ones may be missing. */
    readonly moreRepliesExist: boolean;
  };
  readonly since: string;
  readonly olderThanHours: number;
}

interface Conversation {
  readonly by: "thread" | "timeline" | null;
  readonly id: string;
  readonly replies: Reply[];
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

/** The replies received after the last message sent, oldest first. */
const unanswered = (
  replies: readonly Reply[],
  messages: readonly Message[]
): Reply[] => {
  const lastSent = Math.max(
    Number.NEGATIVE_INFINITY,
    ...messages.flatMap((message) =>
      message.direction === "out" && message.sentAt !== null
        ? [Date.parse(message.sentAt)]
        : []
    )
  );

  return replies
    .filter(
      (reply) => reply.sentAt !== null && Date.parse(reply.sentAt) > lastSent
    )
    .toSorted((left, right) =>
      (left.sentAt ?? "").localeCompare(right.sentAt ?? "")
    );
};

const toDropped = (
  open: readonly Reply[],
  by: "thread" | "timeline",
  now: number
): DroppedReply[] => {
  const [first] = open;

  if (first === undefined || first.sentAt === null) {
    return [];
  }

  const hoursWaiting = round((now - Date.parse(first.sentAt)) / HOUR) ?? 0;

  return [
    {
      campaign: first.campaignRef,
      campaignName: null,
      category: first.category,
      channel: first.channel,
      checkedBy: by,
      finding: `${/^[aeiou]/u.test(first.category) ? "An" : "A"} ${first.category} reply has waited ${waited(hoursWaiting)} with nothing sent after it.`,
      hoursWaiting,
      email: null,
      lead: first.leadRef,
      linkedinUrl: null,
      name: null,
      provider: first.provider,
      receivedAt: first.sentAt,
      reply: first.ref,
      subject: first.subject,
      unansweredReplies: open.length,
    },
  ];
};

const refsOf = (refs: readonly (string | null)[]): string[] => [
  ...new Set(refs.flatMap((ref) => (ref === null ? [] : [ref]))),
];

/**
 * Fills in who is waiting and which campaign they are in. Reads only the
 * leads and campaigns of the dropped replies: one request each.
 */
const named = async (
  context: InsightContext,
  dropped: readonly DroppedReply[]
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

  return dropped.map((each) => {
    const lead = each.lead === null ? undefined : leads.get(each.lead);

    const campaign =
      each.campaign === null ? undefined : campaigns.get(each.campaign);

    return {
      ...each,
      campaignName: campaign?.name ?? null,
      email: lead?.email ?? null,
      linkedinUrl: lead?.linkedinUrl ?? null,
      name: lead === undefined ? null : nameOf(lead),
    };
  });
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

  return readCappedFlag(
    context,
    (cap) =>
      outbound.replies.listAll(filtered ? { max: cap, since } : { max: cap }),
    given ?? WINDOW_REPLIES,
    "replies",
    given === null
      ? "the most one window reads; pass a later since"
      : "max_replies"
  );
};

/**
 * The messages sent by hand since `since`, up to `max`, where the tool can
 * list them by date on its side: one request per page. `null` where it
 * cannot. Only an answer is read from them, so stopping at `max` leaves the
 * rest to be read by thread and loses nothing.
 */
const sentByHand = async (
  context: InsightContext,
  since: string,
  max: number
): Promise<Message[] | null> => {
  const { capabilities, messages } = context.outbound;

  if (
    !capabilities["messages.byHand"] ||
    capabilities["messages.since"] !== "server"
  ) {
    return null;
  }

  const found: Message[] = [];
  let cursor: string | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor of the one before.
    const page = await messages.list({ byHand: true, cursor, since });

    found.push(...context.page(page));
    ({ cursor } = page);
  } while (cursor !== undefined && found.length < max);

  return found;
};

/** The messages sent by hand in one conversation: its thread, or its lead. */
const answersIn = (
  conversation: Conversation,
  sent: readonly Message[]
): Message[] =>
  sent.filter((message) =>
    conversation.by === "thread"
      ? message.threadId === conversation.id
      : message.leadRef === conversation.id
  );

interface Checkable extends Conversation {
  readonly by: "thread" | "timeline";
}

interface Checked {
  answered: number;
  readonly dropped: DroppedReply[];
  tooRecent: number;
}

/**
 * Settles each conversation as answered, too recent or dropped. An answer
 * sent by hand after the replies settles one without reading it, and so does
 * an open reply too recent to count. The rest are read in full, since a
 * campaign send after the reply counts as an answer too.
 */
const check = async (
  context: InsightContext,
  checkable: readonly Checkable[],
  sent: readonly Message[] | null,
  olderThanHours: number
): Promise<Checked> => {
  const checked: Checked = { answered: 0, dropped: [], tooRecent: 0 };

  const openIn = (
    conversation: Checkable,
    messages: readonly Message[]
  ): DroppedReply[] =>
    toDropped(
      unanswered(conversation.replies, messages),
      conversation.by,
      context.now
    );

  // `false` when only a full read can say whether it is dropped.
  const settle = (found: readonly DroppedReply[], whole: boolean): boolean => {
    if (found.length === 0) {
      checked.answered += 1;
    } else if (found.every((each) => each.hoursWaiting < olderThanHours)) {
      checked.tooRecent += 1;
    } else if (whole) {
      checked.dropped.push(...found);
    } else {
      return false;
    }

    return true;
  };

  const toRead =
    sent === null
      ? checkable
      : checkable.filter(
          (conversation) =>
            !settle(openIn(conversation, answersIn(conversation, sent)), false)
        );

  const threads = await mapConcurrent(toRead, async (conversation) => ({
    conversation,
    messages: context.page(
      await (conversation.by === "thread"
        ? context.outbound.thread(conversation.id).messages()
        : context.outbound.lead(conversation.id).timeline())
    ),
  }));

  for (const { conversation, messages } of threads) {
    settle(openIn(conversation, messages), true);
  }

  return checked;
};

export const droppedReplies = defineInsight({
  description:
    "Replies from prospects that nobody answered. Reads every reply since a date (14 days before now by default, up to 2,000 or max_replies), keeps the categories that need an answer, and reports a conversation as dropped when nothing was sent after the reply and it has waited longer than older_than_hours. Where the tool lists the messages sent by hand (messages.byHand), one listing of those in the window settles every answered conversation; a conversation is read in full, by its thread or the lead's timeline, only when it may be dropped. Returns the dropped replies longest waiting first with hours waiting, category, the campaign and its name, and the lead with their name, email and LinkedIn profile. A reply that could not be checked is counted in totals.unchecked, never reported as dropped. Costs one request per page of replies and of messages sent by hand, one per conversation read in full, and one per lead and per campaign among the dropped replies to name them. totals.moreRepliesExist is true when the read stopped with replies left unread.",
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
  next: "Use person_summary with the lead's ref or email address to read what was sent before answering. Use hot_leads to see who else to contact first.",
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
    const replies = read.filter(
      (reply) =>
        reply.sentAt === null || Date.parse(reply.sentAt) >= Date.parse(since)
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

    const { answered, dropped, tooRecent } = await check(
      context,
      checkable,
      sent,
      values.older_than_hours
    );

    const withNames = await named(context, dropped);

    const answer: DroppedReplies = {
      dropped: withNames.toSorted(
        (left, right) =>
          right.hoursWaiting - left.hoursWaiting ||
          left.reply.localeCompare(right.reply)
      ),
      olderThanHours: values.older_than_hours,
      since,
      totals: {
        answered,
        conversations: conversations.length,
        dropped: dropped.length,
        moreRepliesExist: listed.capped,
        repliesRead: read.length,
        skippedAuto: wanted.length - kept.length,
        skippedByCategory: replies.length - wanted.length,
        tooRecent,
        unchecked,
      },
    };

    return answer;
  },
});
