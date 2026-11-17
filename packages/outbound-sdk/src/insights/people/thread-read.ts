// Reading one conversation for its context: a thread by id or a lead's
// timeline. A read that fails leaves the conversation unread, with why; a
// request cap still stops the run.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead, Message } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import type { InsightContext } from "../define.ts";
import { isCapStop } from "../run-cap.ts";
import { recordsMeetings, threadContext } from "./thread-context.ts";
import type { ThreadContext } from "./thread-context.ts";

export interface Target {
  readonly kind: "lead" | "thread";
  readonly id: string;
}

export interface Read {
  readonly target: Target;
  /** `null` when the read failed. */
  readonly messages: readonly Message[] | null;
  /** Why the conversation was not read, such as `the read failed with NotFound`. */
  readonly failed: string | null;
}

export const readConversation = async (
  context: InsightContext,
  target: Target,
  bodies: boolean
): Promise<Read> => {
  const options = bodies ? { include: ["body" as const] } : {};

  try {
    const page = await (target.kind === "thread"
      ? context.outbound.thread(target.id).messages(options)
      : context.outbound.lead(target.id).timeline(options));

    return { failed: null, messages: context.page(page), target };
  } catch (error) {
    if (isCapStop(error)) {
      throw error;
    }

    return {
      failed: `the read failed with ${OutboundError.is(error) ? error.code : "an unexpected error"}`,
      messages: null,
      target,
    };
  }
};

/** A lead's messages in its own campaign: a vendor that uses one id in every campaign returns them all. */
export const inCampaign = (
  messages: readonly Message[],
  lead: Lead | null | undefined
): Message[] =>
  messages.filter(
    (message) =>
      message.campaignRef === null ||
      lead === null ||
      lead === undefined ||
      lead.campaignRef === null ||
      message.campaignRef === lead.campaignRef
  );

/**
 * The context of each lead's conversation, read from its timeline, by lead
 * ref. Where the tool cannot read a timeline, each is unread with that reason.
 */
export const leadContexts = async (
  context: InsightContext,
  leads: readonly Lead[],
  skipped: string | null = null
): Promise<Map<string, ThreadContext>> => {
  const { capabilities } = context.outbound;

  const unread =
    skipped ??
    (capabilities["messages.list"] && capabilities["leads.timeline"]
      ? null
      : "this tool cannot read a lead's timeline (leads.timeline)");

  const reads: readonly Read[] =
    unread === null
      ? await mapConcurrent(leads, (lead) =>
          readConversation(context, { id: lead.ref, kind: "lead" }, false)
        )
      : leads.map((lead) => ({
          failed: unread,
          messages: null,
          target: { id: lead.ref, kind: "lead" as const },
        }));

  return new Map(
    reads.map((read, index) => {
      const lead = leads[index] ?? null;

      return [
        read.target.id,
        threadContext({
          lead,
          meetingsRecorded: recordsMeetings(context.outbound),
          messages:
            read.messages === null ? null : inCampaign(read.messages, lead),
          notRead: read.failed ?? undefined,
          now: context.now,
          provider: lead?.provider ?? context.outbound.provider,
        }),
      ];
    })
  );
};
