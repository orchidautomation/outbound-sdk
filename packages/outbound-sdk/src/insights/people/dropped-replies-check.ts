// dropped_replies' checks: whether anything was sent after each conversation's
// replies, from one listing of answers or a full read of the conversation.

import type { Message, Reply } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { plural } from "../../internal/numbers.ts";
import { noun } from "../../internal/plural.ts";
import type { InsightContext } from "../define.ts";
import { isCapStop } from "../run-cap.ts";
import { round } from "../stats.ts";
import type { ListedAnswers } from "./dropped-replies-listed.ts";
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
  /**
   * Whether the conversation was read in full by its thread or by the lead's
   * timeline, or settled from its latest message alone (`latest`) when the
   * budget left no read for it: that message is the person's reply, so
   * nothing was sent after it, and `hoursWaiting` counts from it.
   */
  readonly checkedBy: "thread" | "timeline" | "latest";
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
  by: DroppedReply["checkedBy"],
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

/** The listed messages of one conversation: its thread, or its lead. */
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

const waitingSince = (conversation: Conversation): number =>
  Math.min(
    ...conversation.replies.flatMap((each) =>
      each.sentAt === null ? [] : [Date.parse(each.sentAt)]
    )
  );

/**
 * Reads each conversation in full, longest waiting first, so a read the
 * budget stops still covers the oldest. A failed read leaves it unchecked,
 * with why; a request cap leaves out the conversations it stopped.
 */
const readFully = async (
  context: InsightContext,
  conversations: readonly Checkable[]
) =>
  await context.each(
    conversations.toSorted(
      (left, right) => waitingSince(left) - waitingSince(right)
    ),
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
 * Settles the conversations the budget left unread whose latest listed
 * message is the person's reply, newer than every reply listed: nothing was
 * sent after it. Only that reply is taken as open, so `hoursWaiting` is a
 * lower bound, and one waiting less than `olderThanHours` is left unread,
 * since an older reply may still be owed. The rule that a reply within a
 * minute of a send is automatic needs the full read, so it is not applied.
 */
const settleByLatest = (
  context: InsightContext,
  unread: readonly Checkable[],
  latest: readonly Message[],
  olderThanHours: number,
  includeAuto: boolean
) => {
  const settled = new Set<Checkable>();
  const dropped: FoundDropped[] = [];

  for (const conversation of unread) {
    const [last] = answersIn(conversation, latest).toSorted((left, right) =>
      (right.sentAt ?? "").localeCompare(left.sentAt ?? "")
    );

    const [newest] = conversation.replies.toSorted((left, right) =>
      (right.sentAt ?? "").localeCompare(left.sentAt ?? "")
    );

    if (
      last === undefined ||
      newest === undefined ||
      last.direction !== "in" ||
      last.sentAt === null ||
      newest.sentAt === null ||
      Date.parse(last.sentAt) < Date.parse(newest.sentAt)
    ) {
      continue;
    }

    const found = toDropped([newest], "latest", context.now, [last]);

    // An automatic latest reply, or one too recent while an older reply may
    // be owed, needs the full read.
    if (
      (!includeAuto && last.isAuto === true) ||
      !found.every((each) => each.hoursWaiting >= olderThanHours)
    ) {
      continue;
    }

    dropped.push(...found);
    settled.add(conversation);
  }

  if (dropped.length > 0) {
    context.note(
      `${plural(dropped.length, "conversation")} ${noun(dropped.length, "was", "were")} settled from ${noun(dropped.length, "its", "their")} latest message, not read in full, because the rate budget ran out (checkedBy latest): that message is the person's reply, so nothing was sent after it. hoursWaiting counts from that reply, a lower bound, and the rule that a reply within a minute of a send is automatic was not applied. Read ${noun(dropped.length, "it", "them")} with thread_context before following up.`
    );
  }

  return { dropped, settled };
};

/**
 * Settles each conversation as answered, too recent or dropped. A listed
 * message sent after the replies settles one without reading it, and so does
 * an open reply too recent to count, unless the listing stopped at its max
 * and its answer may lie past the stop. The rest are read in full, longest
 * waiting first, so a read the budget stops still covers the oldest: with
 * only the messages sent by hand listed, a campaign send after the reply
 * counts as an answer too.
 */
export const check = async (
  context: InsightContext,
  checkable: readonly Checkable[],
  sent: ListedAnswers | null,
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

  const unreadOnes = toRead.filter(
    (conversation) =>
      !threads.some(
        (each) => each.conversation === conversation && each.failed === null
      )
  );

  const byLatest = settleByLatest(
    context,
    unreadOnes,
    sent?.latest ?? [],
    olderThanHours,
    includeAuto
  );

  checked.dropped.push(...byLatest.dropped);

  const failedOf = new Map(
    threads.flatMap(({ conversation, failed }) =>
      failed === null ? [] : [[conversation, failed] as const]
    )
  );

  const remaining = unreadOnes.filter(
    (conversation) => !byLatest.settled.has(conversation)
  );

  const reasons = new Set(
    remaining.map(
      (conversation) =>
        failedOf.get(conversation) ?? "the request cap stopped the read"
    )
  );

  checked.unread += remaining.length;

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
    }
  }

  noteChecked(context, checked, reasons);

  return checked;
};

const noteChecked = (
  context: InsightContext,
  checked: Checked,
  reasons: ReadonlySet<string>
): void => {
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
};
