// thread_context: the conversations behind given leads or threads, read in
// batches, each with who wrote last, the meeting the vendor records and a
// follow-up assessment from fixed rules, plus what was and was not covered.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead, Message } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { assertRefReadable, leadRefParts } from "../../internal/person.ts";
import { untrusted } from "../../tools/shared.ts";
import { defineInsight, maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { readByRef } from "./read.ts";
import {
  recordsMeetings,
  threadContext,
  withoutBody,
} from "./thread-context.ts";
import type { LatestMessage, ThreadContext } from "./thread-context.ts";
import { inCampaign, readConversation } from "./thread-read.ts";
import type { Read, Target } from "./thread-read.ts";

/** The most characters of a message a snippet keeps. */
const SNIPPET_CHARS = 280;

const ids = (what: string) =>
  z.array(z.string().min(1)).max(100).default([]).describe(what);

const input = z.object({
  bodies: z
    .enum(["none", "snippet"])
    .default("snippet")
    .describe(
      "snippet returns the first 280 characters of each message, wrapped as untrusted content; none returns no text"
    ),
  cursor: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "coverage.nextCursor from the previous call with the same leads and threads, to read the next page of conversations"
    ),
  leads: ids(
    "Lead refs (provider:workspace:id), as dropped_replies, hot_leads and person_summary return them. Each lead's conversation in its campaign is read."
  ),
  max_messages: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe(
      "The newest messages returned per conversation. Every message is still read, so the latest is always found."
    ),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe(
      "Conversations read per call. Each costs one walk of its messages."
    ),
  threads: ids("Thread ids, from a message's or reply's threadId"),
});

type Input = z.infer<typeof input>;

/** One message of a conversation, with a snippet instead of its body. */
export type ThreadMessage = LatestMessage & {
  readonly snippet: ReturnType<typeof untrusted>;
};

export interface ThreadRecord extends ThreadContext {
  readonly target: Target;
  /** The lead the conversation is with. `null` when no message names one. */
  readonly lead: string | null;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly campaign: string | null;
  readonly threadIds: readonly string[];
  /** The newest `max_messages` messages, oldest first. */
  readonly messages: readonly ThreadMessage[];
  /** Messages read but left out by `max_messages`. */
  readonly messagesOmitted: number;
}

export interface Uncovered {
  readonly target: Target;
  readonly reason: string;
}

export interface ThreadContexts {
  /** In the order asked: leads first, then threads. */
  readonly threads: readonly ThreadRecord[];
  readonly coverage: {
    /** Distinct leads and threads asked for, over every page. */
    readonly requested: number;
    /** Asked for and read on this page. */
    readonly checked: number;
    /** Read, with at least one message. */
    readonly found: number;
    /** Read and empty: an unknown thread, or a lead never written to. */
    readonly notFound: readonly Uncovered[];
    /** Asked for on this page but not read, with why. Their records say the same. */
    readonly unchecked: readonly Uncovered[];
    /** Asked for and left to later pages. */
    readonly remaining: number;
    /** Pass as `cursor` to read the next page. `null` on the last page. */
    readonly nextCursor: string | null;
  };
}

const targetsOf = (values: Input): Target[] => [
  ...[...new Set(values.leads)].map((id) => ({ id, kind: "lead" as const })),
  ...[...new Set(values.threads)].map((id) => ({
    id,
    kind: "thread" as const,
  })),
];

/** Where this page starts. A cursor is `offset/total` of the same request. */
const startOf = (cursor: string | null, total: number): number => {
  if (cursor === null) {
    return 0;
  }

  const [offset, of] = cursor.split("/").map(Number);

  if (
    offset === undefined ||
    of !== total ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= total
  ) {
    throw new OutboundError(
      "Invalid",
      "thread_context: cursor does not belong to these leads and threads; pass the nextCursor of a call with the same leads and threads"
    );
  }

  return offset;
};

/** The lead a conversation is with: the one asked for, or the one its messages name. */
const leadRefOf = (read: Read): string | null =>
  read.target.kind === "lead"
    ? read.target.id
    : (read.messages?.find((message) => message.leadRef !== null)?.leadRef ??
      null);

const toMessage = (message: Message, bodies: boolean): ThreadMessage => ({
  ...withoutBody(message),
  snippet: bodies
    ? untrusted(
        message.bodyText?.replaceAll(/\s+/gu, " ").trim() || null,
        SNIPPET_CHARS
      )
    : null,
});

/** Who the conversation is with, from the lead or else its messages. */
const partyOf = (lead: Lead | undefined, messages: readonly Message[]) => ({
  campaign:
    lead?.campaignRef ??
    messages.find((message) => message.campaignRef !== null)?.campaignRef ??
    null,
  email: lead?.email ?? null,
  linkedinUrl: lead?.linkedinUrl ?? null,
  threadIds: [
    ...new Set(
      messages.flatMap((message) =>
        message.threadId === null ? [] : [message.threadId]
      )
    ),
  ],
});

const recordOf = (
  context: InsightContext,
  read: Read,
  lead: Lead | undefined,
  values: Input
): ThreadRecord => {
  const messages =
    read.messages === null
      ? null
      : inCampaign(read.messages, lead).toSorted((left, right) =>
          (left.sentAt ?? "").localeCompare(right.sentAt ?? "")
        );

  const all = messages ?? [];
  const shown = all.slice(-values.max_messages);

  return {
    ...threadContext({
      lead: lead ?? null,
      meetingsRecorded: recordsMeetings(context.outbound),
      messages,
      notRead: read.failed ?? undefined,
      now: context.now,
      provider: lead?.provider ?? all[0]?.provider ?? context.outbound.provider,
    }),
    ...partyOf(lead, all),
    lead: leadRefOf(read),
    messages: shown.map((message) =>
      toMessage(message, values.bodies === "snippet")
    ),
    messagesOmitted: all.length - shown.length,
    target: read.target,
  };
};

const coverageOf = (
  records: readonly ThreadRecord[],
  reads: readonly Read[],
  page: { start: number; total: number }
): ThreadContexts["coverage"] => {
  const end = page.start + reads.length;

  return {
    checked: reads.filter((read) => read.failed === null).length,
    found: records.filter((record) => record.activity.messagesRead > 0).length,
    nextCursor: end < page.total ? `${end}/${page.total}` : null,
    notFound: records.flatMap((record, index) =>
      reads[index]?.failed === null && record.activity.messagesRead === 0
        ? [{ reason: "read, with no messages", target: record.target }]
        : []
    ),
    remaining: page.total - end,
    requested: page.total,
    unchecked: reads.flatMap((read) =>
      read.failed === null ? [] : [{ reason: read.failed, target: read.target }]
    ),
  };
};

export const threadContexts = defineInsight({
  description:
    "Reads the conversations behind given lead refs or thread ids, in pages, without a campaign-wide reply read: each conversation's newest messages (a 280-character snippet each, wrapped as untrusted content, unless bodies is none), who wrote last and when, the meeting the vendor records on the lead (Instantly's interest status; other vendors record none, which the answer says), the vendor's own labels kept apart in vendorSentiment, and a follow-up assessment from fixed rules: needed is true only when the latest message is inbound, not automatic and no meeting is recorded, false when the latest message is outbound or a meeting is recorded, null otherwise, with the evidence it used and what it could not check. No rule reads what a message says, so read the latest message before acting on it. coverage gives how many were requested, read and found, which could not be read and why, and nextCursor for the next page. Costs one walk of messages per conversation and up to one lead read per conversation.",
  inputSchema: input,
  key: "threadContext",
  cost: (values, price) => {
    const conversations = Math.min(
      values.page_size,
      new Set(values.leads).size + new Set(values.threads).size
    );

    return (
      conversations * price.walk("messages.list") +
      (price.capabilities["leads.get"] === false
        ? 0
        : price.upTo(conversations) * price.one("leads.get"))
    );
  },
  name: "thread_context",
  needs: ["messages.list"],
  needsFor: ({ leads, threads }) => [
    ...(leads.length > 0 ? (["leads.timeline"] as const) : []),
    ...(threads.length > 0 ? (["messages.byThread"] as const) : []),
  ],
  next: "Read each record's latest message before following up. Use person_summary with a lead ref for the person's other campaigns.",
  run: async (context, values) => {
    const targets = targetsOf(values);

    if (targets.length === 0) {
      context.note(
        "No lead refs or thread ids were given, so nothing was read. Pass leads or threads."
      );
    }

    if (
      values.bodies === "snippet" &&
      (maskingOf(context.outbound)?.fields.includes("body") ?? false)
    ) {
      throw new OutboundError(
        "Unsupported",
        "thread_context: the redact plugin masks message bodies, so snippets cannot be returned; pass bodies: none"
      );
    }

    for (const target of targets) {
      const parts = target.kind === "lead" ? leadRefParts(target.id) : null;

      if (target.kind === "lead" && parts === null) {
        throw new OutboundError(
          "Invalid",
          `thread_context: "${target.id}" is not a lead ref (provider:workspace:id); pass the lead ref another tool returned`,
          { provider: context.outbound.provider }
        );
      }

      if (parts !== null) {
        assertRefReadable(context.outbound, { ...parts, text: target.id });
      }
    }

    const start = startOf(values.cursor, targets.length);
    const page = targets.slice(start, start + values.page_size);

    const reads = await mapConcurrent(page, (target) =>
      readConversation(context, target, values.bodies === "snippet")
    );

    const refs = [
      ...new Set(
        reads.flatMap((read) => {
          const ref = leadRefOf(read);

          return ref === null ? [] : [ref];
        })
      ),
    ];

    const leads = context.outbound.capabilities["leads.get"]
      ? await readByRef<Lead>(
          context,
          refs,
          (each) => context.outbound.leads.getMany(each),
          ["lead", "leads"],
          "meetings and labels are unknown"
        )
      : new Map<string, Lead>();

    const records = reads.map((read) => {
      const ref = leadRefOf(read);

      return recordOf(
        context,
        read,
        ref === null ? undefined : leads.get(ref),
        values
      );
    });

    if (start + page.length < targets.length) {
      context.partial(
        `Read ${start + page.length} of ${targets.length} conversations; pass coverage.nextCursor for the rest.`
      );
    }

    const answer: ThreadContexts = {
      coverage: coverageOf(records, reads, { start, total: targets.length }),
      threads: records,
    };

    return answer;
  },
});
