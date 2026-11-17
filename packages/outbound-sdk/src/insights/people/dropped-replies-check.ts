// dropped_replies' checks: whether anything was sent after each conversation's
// replies, from the messages sent by hand or a full read of the conversation.

import type { Message, Reply } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import type { InsightContext } from "../define.ts";
import { isCapStop } from "../run-cap.ts";
import { round } from "../stats.ts";
import { activityOf, waited } from "./thread-context.ts";
import type { LabelledReply, ThreadContext } from "./thread-context.ts";

export const HOUR = 3_600_000;

/**
 * The thread's context fields (`activity`, `meeting`, `vendorSentiment`,
 * `followUp`) are always set by dropped_replies; optional so a value built
 * by hand stays valid.
 */
export interface DroppedReply extends Partial<ThreadContext> {
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
  /** What was found, with the latest message and any meeting the vendor records. */
  readonly finding: string;
}

/** A dropped reply before its lead is read, with the conversation it was found in. */
export type FoundDropped = Omit<DroppedReply, keyof ThreadContext> & {
  readonly labelled: LabelledReply;
  readonly messages: readonly Message[];
};

export interface Conversation {
  readonly by: "thread" | "timeline" | null;
  readonly id: string;
  readonly replies: Reply[];
}

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
  now: number,
  messages: readonly Message[]
): FoundDropped[] => {
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
      labelled: {
        category: first.category,
        ref: first.ref,
        sentAt: first.sentAt,
      },
      lead: first.leadRef,
      linkedinUrl: null,
      messages,
      name: null,
      provider: first.provider,
      receivedAt: first.sentAt,
      reply: first.ref,
      subject: first.subject,
      unansweredReplies: open.length,
    },
  ];
};

interface SentByHand {
  readonly messages: readonly Message[];
  /** `false` when the listing stopped at its max with more left. */
  readonly whole: boolean;
}

/**
 * The messages sent by hand since `since`, up to `max`, where the tool can
 * list them by date on its side: one request per page. `null` where it
 * cannot. Only an answer is read from them, so stopping at `max` leaves the
 * rest to be read by thread and loses nothing.
 */
export const sentByHand = async (
  context: InsightContext,
  since: string,
  max: number
): Promise<SentByHand | null> => {
  const { capabilities, messages } = context.outbound;

  if (
    !capabilities["messages.byHand"] ||
    capabilities["messages.since"] !== "server"
  ) {
    return null;
  }

  // Its cost is counted, but a stop at `max` does not make the answer partial.
  // A request cap that stops it leaves every conversation to be read in full.
  const walk = messages.listAll({ byHand: true, max, since });

  const [found] = await context.each(
    [walk],
    async (each) => await each.toArray(),
    "listings of the messages sent by hand"
  );

  if (found === undefined) {
    return null;
  }

  if (walk.meta !== undefined) {
    context.one({ meta: walk.meta });
  }

  if (walk.truncated) {
    context.note(
      `The messages sent by hand stopped at ${max}, so each conversation they did not settle was read in full.`
    );
  }

  return { messages: found, whole: !walk.truncated };
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

export interface Checkable extends Conversation {
  readonly by: "thread" | "timeline";
}

interface Checked {
  answered: number;
  /** Conversations whose latest message, read in full, is an automatic reply. */
  automatic: number;
  /** The listed replies of those conversations. */
  automaticReplies: number;
  readonly dropped: FoundDropped[];
  tooRecent: number;
  /** Conversations whose read failed. */
  unread: number;
}

/**
 * Reads each conversation in full. A failed read leaves it unchecked, with
 * why; a request cap leaves out the conversations it stopped.
 */
const readFully = async (
  context: InsightContext,
  conversations: readonly Checkable[]
) =>
  await context.each(
    conversations,
    async (conversation) => {
      try {
        const read = await (conversation.by === "thread"
          ? context.outbound.thread(conversation.id).messages()
          : context.outbound.lead(conversation.id).timeline());

        return { conversation, failed: null, messages: context.page(read) };
      } catch (error) {
        if (isCapStop(error)) {
          throw error;
        }

        return {
          conversation,
          failed: OutboundError.is(error) ? error.code : "an unexpected error",
          messages: [],
        };
      }
    },
    "conversations"
  );

/**
 * Settles each conversation as answered, too recent or dropped. An answer
 * sent by hand after the replies settles one without reading it, and so does
 * an open reply too recent to count, unless the listing stopped at its max
 * and its answer may lie past the stop. The rest are read in full, since a
 * campaign send after the reply counts as an answer too.
 */
export const check = async (
  context: InsightContext,
  checkable: readonly Checkable[],
  sent: SentByHand | null,
  olderThanHours: number,
  includeAuto: boolean
): Promise<Checked> => {
  const checked: Checked = {
    answered: 0,
    automatic: 0,
    automaticReplies: 0,
    dropped: [],
    tooRecent: 0,
    unread: 0,
  };

  const openIn = (
    conversation: Checkable,
    messages: readonly Message[]
  ): FoundDropped[] =>
    toDropped(
      unanswered(conversation.replies, messages),
      conversation.by,
      context.now,
      messages
    );

  // `false` when only a full read can say whether it is dropped.
  // `automaticReplies` is set when a full read ends in an automatic reply.
  const settle = (
    found: readonly FoundDropped[],
    whole: boolean,
    automaticReplies = 0
  ): boolean => {
    if (found.length === 0) {
      checked.answered += 1;
    } else if (found.every((each) => each.hoursWaiting < olderThanHours)) {
      checked.tooRecent += 1;
    } else if (automaticReplies > 0) {
      checked.automatic += 1;
      checked.automaticReplies += automaticReplies;
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
      : checkable.filter((conversation) => {
          const found = openIn(
            conversation,
            answersIn(conversation, sent.messages)
          );

          // A listing that stopped early may hold the answer past its stop.
          return !((found.length === 0 || sent.whole) && settle(found, false));
        });

  const threads = await readFully(context, toRead);
  const stopped = toRead.length - threads.length;

  const reasons = new Set<string>(
    stopped > 0 ? ["the request cap stopped the read"] : []
  );

  checked.unread += stopped;

  for (const { conversation, failed, messages } of threads) {
    if (failed === null) {
      // The full read applies every auto-reply rule, timing included, which a reply listing cannot.
      const { latest } = activityOf(messages);

      const endsAutomatic =
        !includeAuto && latest?.direction === "in" && latest.isAuto === true;

      settle(
        openIn(conversation, messages),
        true,
        endsAutomatic ? conversation.replies.length : 0
      );
    } else {
      checked.unread += 1;
      reasons.add(failed);
    }
  }

  if (checked.automatic > 0) {
    context.note(
      `${plural(checked.automatic, "conversation")} ended in an automatic reply once read in full (such as one within a minute of the email it answers), so ${noun(checked.automatic, "its", "their")} ${plural(checked.automaticReplies, "reply", "replies")} ${noun(checked.automaticReplies, "is", "are")} counted in totals.skippedAuto, not as dropped. Pass include_auto: true to list them.`
    );
  }

  if (checked.unread > 0) {
    context.note(
      `${plural(checked.unread, "conversation")} could not be read, so ${noun(checked.unread, "it is", "they are")} counted in totals.unchecked, not as dropped (${[...reasons].join("; ")}).`
    );
  }

  return checked;
};
