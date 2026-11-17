// dropped_replies' checks: whether anything was sent after each conversation's
// replies, from the messages sent by hand or a full read of the conversation.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Message, Reply } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import type { InsightContext } from "../define.ts";
import { isCapStop } from "../run-cap.ts";
import { round } from "../stats.ts";

export const HOUR = 3_600_000;

/** A wait as a person says it: in hours under two days, in whole days after. */
const waited = (hours: number): string =>
  hours >= 48
    ? plural(Math.floor(hours / 24), "day")
    : plural(Math.floor(hours), "hour");

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
  const walk = messages.listAll({ byHand: true, max, since });
  const found = await walk.toArray();

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
  readonly dropped: DroppedReply[];
  tooRecent: number;
  /** Conversations whose read failed. */
  unread: number;
}

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
  olderThanHours: number
): Promise<Checked> => {
  const checked: Checked = {
    answered: 0,
    dropped: [],
    tooRecent: 0,
    unread: 0,
  };

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
      : checkable.filter((conversation) => {
          const found = openIn(
            conversation,
            answersIn(conversation, sent.messages)
          );

          // A listing that stopped early may hold the answer past its stop.
          return !((found.length === 0 || sent.whole) && settle(found, false));
        });

  // A failed read leaves its conversation unchecked; a request cap still stops the run.
  const threads = await mapConcurrent(toRead, async (conversation) => {
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
  });

  const reasons = new Set<string>();

  for (const { conversation, failed, messages } of threads) {
    if (failed === null) {
      settle(openIn(conversation, messages), true);
    } else {
      checked.unread += 1;
      reasons.add(failed);
    }
  }

  if (checked.unread > 0) {
    context.note(
      `${plural(checked.unread, "conversation")} could not be read, so ${noun(checked.unread, "it is", "they are")} counted in totals.unchecked, not as dropped (${[...reasons].join("; ")}).`
    );
  }

  return checked;
};
