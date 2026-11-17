// Reading one conversation for its context: a thread by id or a lead's
// timeline. A target this instance cannot read is refused before any
// request; a read that fails leaves the conversation unread, with why; a
// request cap still stops the run.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead, Message } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { assertRefReadable, leadRefParts } from "../../internal/person.ts";
import { maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { isCapStop } from "../run-cap.ts";
import { recordsMeetings, threadContext } from "./thread-context.ts";
import type { ThreadContext } from "./thread-context.ts";

/** A token the redact plugin writes for an address or a profile. */
const REDACT_TOKEN = /redacted:[0-9a-f]{16}/gu;

/** The most refs an error names before it counts the rest. */
const NAMED_REFS = 3;

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

/**
 * Snippets unless asked for none, or none when redact masks message text.
 * Asking for snippets that redact masks is refused.
 */
export const bodiesOf = (
  context: InsightContext,
  asked: "none" | "snippet" | null
): "none" | "snippet" => {
  const masksBodies =
    maskingOf(context.outbound)?.fields.includes("body") ?? false;

  if (asked === "snippet" && masksBodies) {
    throw new OutboundError(
      "Unsupported",
      "thread_context: the redact plugin masks message bodies, so snippets cannot be returned; pass bodies: none"
    );
  }

  if (asked === null && masksBodies) {
    context.note(
      "The redact plugin masks message bodies, so no snippets are returned (bodies: none)."
    );
  }

  return asked ?? (masksBodies ? "none" : "snippet");
};

/** The refs among `targets` that hold a redact token this instance cannot put back. */
const staleOf = (
  context: InsightContext,
  targets: readonly Target[]
): Target[] => {
  const resolves = maskingOf(context.outbound)?.resolves;

  return resolves === undefined
    ? []
    : targets.filter((target) =>
        [...target.id.matchAll(REDACT_TOKEN)].some(
          ([token]) => resolves(token) === null
        )
      );
};

/**
 * Refuses, before any request, a target this instance cannot read: a redact
 * token from another session, which would reach the vendor as it is and fail
 * there; text that is not a lead ref; a ref of another tool or workspace.
 */
export const refuseUnreadable = (
  context: InsightContext,
  targets: readonly Target[]
): void => {
  const { provider } = context.outbound;
  const stale = staleOf(context, targets);

  if (stale.length > 0) {
    const named = stale
      .slice(0, NAMED_REFS)
      .map((target) => `"${target.id}"`)
      .join(", ");

    const more =
      stale.length > NAMED_REFS ? ` and ${stale.length - NAMED_REFS} more` : "";

    const one = stale.length === 1;

    throw new OutboundError(
      "NotFound",
      `thread_context: ${named}${more} ${one ? "holds a redacted token" : "hold redacted tokens"} from another session. The redact plugin keeps what each token stands for in memory, only in the process that wrote it, so a token from an earlier MCP server or CLI run cannot be read here. Run the tool that returned ${one ? "it" : "them"} (such as dropped_replies) again in this session and pass the refs it returns.`,
      { provider }
    );
  }

  for (const target of targets) {
    const parts = target.kind === "lead" ? leadRefParts(target.id) : null;

    if (target.kind === "lead" && parts === null) {
      throw new OutboundError(
        "Invalid",
        `thread_context: "${target.id}" is not a lead ref (provider:workspace:id); pass the lead ref another tool returned`,
        { provider }
      );
    }

    if (parts !== null) {
      assertRefReadable(context.outbound, { ...parts, text: target.id });
    }
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
