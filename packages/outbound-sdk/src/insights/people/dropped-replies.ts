// dropped_replies: replies nobody answered.

import { z } from "zod";

import { replyCategorySchema } from "../../internal/entities.ts";
import type { Message, Reply } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { round } from "../stats.ts";
import { readCapped } from "./read.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_DAYS = 14;

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
      "Set to true to also check replies the vendor marks as automatic"
    ),
  max_replies: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(50)
    .describe(
      "The most replies to read. Each conversation among them costs one more request to check."
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
  readonly campaign: string | null;
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
    /** Left out because the vendor marks them as automatic. */
    readonly skippedAuto: number;
    /** Conversations the remaining replies belong to. */
    readonly conversations: number;
    readonly answered: number;
    readonly dropped: number;
    /** Unanswered, but waiting less than `older_than_hours`. */
    readonly tooRecent: number;
    /** Could not be checked: no thread or lead to read, or no time on the reply. Not counted as dropped. */
    readonly unchecked: number;
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
      category: first.category,
      channel: first.channel,
      checkedBy: by,
      finding: `A ${first.category} reply has waited ${Math.floor(hoursWaiting)} hours with nothing sent after it.`,
      hoursWaiting,
      lead: first.leadRef,
      provider: first.provider,
      receivedAt: first.sentAt,
      reply: first.ref,
      subject: first.subject,
      unansweredReplies: open.length,
    },
  ];
};

const readReplies = (
  context: InsightContext,
  since: string,
  max: number
): Promise<Reply[]> => {
  const { outbound } = context;
  const filtered = outbound.capabilities["replies.since"] !== false;

  if (!filtered) {
    context.note(
      "This tool cannot filter replies by date, so the newest replies were read and filtered here."
    );
  }

  return readCapped(
    context,
    (cap) =>
      outbound.replies.listAll(filtered ? { max: cap, since } : { max: cap }),
    max,
    "replies"
  );
};

export const droppedReplies = defineInsight({
  description:
    "Replies from prospects that nobody answered. Reads the replies since a date (14 days before now by default), keeps the categories that need an answer, and for each conversation reads its thread, or the lead's timeline when there is no thread, and reports it as dropped when nothing was sent after the reply and it has waited longer than older_than_hours. Returns the dropped replies longest waiting first with hours waiting, category, campaign and lead. A reply that could not be checked is counted in totals.unchecked, never reported as dropped. Costs one request per page of replies plus one per conversation checked, so at most about max_replies requests.",
  inputSchema: input,
  key: "droppedReplies",
  name: "dropped_replies",
  needs: ["replies.list"],
  next: "Use person_summary with the lead's email address to read what was sent before answering, or hot_leads to see who else to contact first.",
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

    const read = await readReplies(context, since, values.max_replies);

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
    const dropped: DroppedReply[] = [];
    let answered = 0;
    let unchecked = 0;
    let tooRecent = 0;

    for (const conversation of conversations) {
      const timed = conversation.replies.some((each) => each.sentAt !== null);

      if (conversation.by === null || !timed) {
        unchecked += 1;
      } else {
        const messages = context.page(
          // oxlint-disable-next-line no-await-in-loop -- one conversation at a time keeps the rate budget predictable.
          await (conversation.by === "thread"
            ? context.outbound.thread(conversation.id).messages()
            : context.outbound.lead(conversation.id).timeline())
        );

        const found = toDropped(
          unanswered(conversation.replies, messages),
          conversation.by,
          context.now
        );

        const old = found.filter(
          (each) => each.hoursWaiting >= values.older_than_hours
        );

        dropped.push(...old);
        answered += found.length === 0 ? 1 : 0;
        tooRecent += found.length - old.length;
      }
    }

    const answer: DroppedReplies = {
      dropped: dropped.toSorted(
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
