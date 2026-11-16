// What a page of emails says about the replies in it once both directions are
// read together: the message each reply answers.

import { answeredAtOnce } from "../internal/auto-reply.ts";
import type { Message } from "../internal/entities.ts";

const timeOf = (message: Message): number =>
  message.sentAt === null ? Number.NaN : Date.parse(message.sentAt);

/** A received message, with the step of the send it answers and the timing rule applied. */
const answering = (message: Message, answered: Message): Message => {
  const next: Message = { ...message };

  if (answered.stepIndex !== null) {
    next.stepIndex = answered.stepIndex;
    next.variantKey = answered.variantKey;
  }

  if (
    message.isAutoSource !== "vendor" &&
    answeredAtOnce(answered.sentAt, message.sentAt)
  ) {
    next.isAuto = true;
    next.isAutoSource = "rule";
  }

  return next;
};

/**
 * Sets each received email's step from the sent email it answers: the last
 * one sent before it in its thread. A received email's own `step` lags on a
 * sequence's last step (seen live 2026-11-15: a reply to step 3 carried step
 * 2). A reply under a minute after that send is automatic unless Instantly
 * said otherwise. A reply with no earlier send in its thread is left as it is.
 */
export const withAnsweredSteps = (messages: readonly Message[]): Message[] => {
  const order = messages
    .flatMap((message, index) =>
      Number.isNaN(timeOf(message)) ? [] : [{ index, message }]
    )
    .toSorted(
      (left, right) =>
        timeOf(left.message) - timeOf(right.message) || left.index - right.index
    );

  const lastSent = new Map<string, Message>();
  const result = [...messages];

  for (const { index, message } of order) {
    const thread = message.threadId;

    if (thread !== null && message.direction === "out") {
      lastSent.set(thread, message);
    }

    const answered =
      thread === null || message.direction === "out"
        ? undefined
        : lastSent.get(thread);

    if (answered !== undefined) {
      result[index] = answering(message, answered);
    }
  }

  return result;
};
