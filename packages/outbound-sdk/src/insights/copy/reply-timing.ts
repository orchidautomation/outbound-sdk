// reply_timing: how fast people reply, and on which day and hour.

import { z } from "zod";

import type { Message } from "../../internal/entities.ts";
import { confirmCampaign } from "../campaign.ts";
import { readCapped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { median, percentile, rate, round } from "../stats.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "A campaign's ref to look at one campaign; an unknown one is refused with NotFound. null looks at every campaign."
    ),
  max_messages: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(2000)
    .describe(
      "The most messages to read, sent and received together. A page of messages costs 1 request."
    ),
  since: z.iso
    .datetime({ offset: true })
    .nullable()
    .default(null)
    .describe(
      "Only messages from this time on, ISO 8601. null means 30 days before now."
    ),
  timezone_offset_minutes: z
    .number()
    .int()
    .min(-720)
    .max(840)
    .default(0)
    .describe(
      "Minutes to add to UTC for the weekday and hour tables, for example -300 for New York in winter."
    ),
});

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface WeekdayCount {
  readonly weekday: (typeof WEEKDAYS)[number];
  readonly count: number;
  readonly share: number | null;
}

export interface HourCount {
  /** 0 to 23, in the given offset. */
  readonly hour: number;
  readonly count: number;
  readonly share: number | null;
}

export interface TimeTable {
  /** Monday first. */
  readonly byWeekday: readonly WeekdayCount[];
  /** Hour 0 to hour 23. */
  readonly byHour: readonly HourCount[];
  /** The weekday with the most. `null` when there is nothing to count. */
  readonly topWeekday: string | null;
  readonly topHour: number | null;
}

export interface ReplyTiming {
  readonly campaign: string | null;
  readonly since: string;
  readonly timezoneOffsetMinutes: number;
  readonly timeToReply: {
    /** Replies paired with the message they answer. Every figure below rests on this many. */
    readonly sample: number;
    readonly medianHours: number | null;
    readonly p75Hours: number | null;
    readonly p90Hours: number | null;
    /** Share of paired replies that came within the hour. */
    readonly within1Hour: number | null;
    readonly within24Hours: number | null;
    readonly within72Hours: number | null;
  };
  /** When replies arrive, over every reply with a time. */
  readonly replies: TimeTable;
  /** When the sends that drew a reply went out, over the paired replies. */
  readonly sendsThatDrewReplies: TimeTable;
  readonly counts: {
    readonly messagesRead: number;
    readonly sent: number;
    readonly received: number;
    readonly paired: number;
    /** A further message from someone who had already replied, before anything new was sent. Not timed. */
    readonly followOnReplies: number;
    /** Replies with no earlier send in what was read, no thread or lead to match on, or no time. */
    readonly unpaired: number;
  };
}

interface Sent {
  readonly at: number;
  answered: boolean;
}

interface Pairing {
  /** One entry per paired reply: when it was sent to, and when the reply came. */
  readonly pairs: readonly { readonly sentAt: number; readonly at: number }[];
  readonly replyTimes: readonly number[];
  readonly followOn: number;
  readonly unpaired: number;
}

const timeOf = (message: Message): number | null =>
  message.sentAt === null ? null : Date.parse(message.sentAt);

/** Pairs each reply with the last send before it in its thread, or to its lead. */
const pair = (messages: readonly Message[]): Pairing => {
  const byThread = new Map<string, Sent>();
  const byLead = new Map<string, Sent>();
  const pairs: { sentAt: number; at: number }[] = [];
  const replyTimes: number[] = [];
  let followOn = 0;
  let unpaired = 0;

  const timed = messages
    .flatMap((message) => {
      const at = timeOf(message);

      return at === null ? [] : [{ at, message }];
    })
    .toSorted((left, right) => left.at - right.at);

  for (const { at, message } of timed) {
    const { leadRef } = message;

    // A thread id is the vendor's own, so two tools can use the same one.
    const threadId =
      message.threadId === null
        ? null
        : `${message.provider}:${message.workspaceId}:${message.threadId}`;

    if (message.direction === "out") {
      const sent: Sent = { answered: false, at };

      if (threadId !== null) {
        byThread.set(threadId, sent);
      }

      if (leadRef !== null) {
        byLead.set(leadRef, sent);
      }
    } else {
      replyTimes.push(at);

      const sent =
        (threadId === null ? undefined : byThread.get(threadId)) ??
        (leadRef === null ? undefined : byLead.get(leadRef));

      if (sent === undefined) {
        unpaired += 1;
      } else if (sent.answered) {
        followOn += 1;
      } else {
        sent.answered = true;
        pairs.push({ at, sentAt: sent.at });
      }
    }
  }

  return { followOn, pairs, replyTimes, unpaired };
};

const topOf = <Entry extends { readonly count: number }>(
  entries: readonly Entry[]
): Entry | null => {
  let top: Entry | null = null;

  for (const entry of entries) {
    if (entry.count > (top?.count ?? 0)) {
      top = entry;
    }
  }

  return top;
};

const tableOf = (
  times: readonly number[],
  offsetMinutes: number
): TimeTable => {
  const days = Array.from({ length: 7 }, () => 0);
  const hours = Array.from({ length: 24 }, () => 0);

  for (const time of times) {
    const local = new Date(time + offsetMinutes * MINUTE_MS);

    days[local.getUTCDay()] = (days[local.getUTCDay()] ?? 0) + 1;
    hours[local.getUTCHours()] = (hours[local.getUTCHours()] ?? 0) + 1;
  }

  // Monday first: the working week reads left to right.
  const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
    count: days[day] ?? 0,
    share: rate(days[day] ?? 0, times.length),
    weekday: WEEKDAYS[day] ?? "Sunday",
  }));

  const byHour = hours.map((count, hour) => ({
    count,
    hour,
    share: rate(count, times.length),
  }));

  return {
    byHour,
    byWeekday,
    topHour: topOf(byHour)?.hour ?? null,
    topWeekday: topOf(byWeekday)?.weekday ?? null,
  };
};

const readMessages = async (
  context: InsightContext,
  campaign: string | null,
  since: string,
  max: number
): Promise<Message[]> => {
  const { outbound } = context;

  // A vendor that cannot filter by date is read from the newest back and filtered here.
  const filters =
    outbound.capabilities["messages.since"] === false ? {} : { since };

  const { items: messages } = await readCapped(
    context,
    (cap) =>
      campaign === null
        ? outbound.messages.listAll({ ...filters, max: cap })
        : outbound
            .campaign(campaign)
            .messages.listAll({ ...filters, max: cap }),
    { input: "max_messages", max, what: "messages" }
  );

  // An unknown campaign lists no messages, which would read as nobody replied.
  if (campaign !== null && messages.length === 0) {
    await confirmCampaign(context, campaign);
  }

  if (outbound.capabilities["messages.since"] === false) {
    context.note(
      "This tool cannot filter messages by date, so the cap applies to all messages and older ones were dropped after reading."
    );
  }

  return messages.filter(
    (message) => message.sentAt === null || message.sentAt >= since
  );
};

export const replyTiming = defineInsight({
  description:
    "How fast people reply and when. Pairs each received message with the last message sent before it in the same thread (or to the same lead) and returns the median, 75th and 90th percentile of hours to reply, the share of replies within 1, 24 and 72 hours, replies by weekday and by hour of day, the weekday and hour of the sends that drew replies, and how many replies could not be paired. Use it to choose follow-up delays and sending hours. Costs 1 request per page of messages, up to max_messages. A null figure means no reply could be paired; auto-replies are not separated, because messages carry no auto flag.",
  inputSchema: input,
  key: "replyTiming",
  name: "reply_timing",
  needs: ["messages.list"],
  next: "Use step_funnel to see which step the replies answer, then set follow-up delays near the median time to reply.",
  run: async (context, args) => {
    const since =
      args.since === null
        ? new Date(context.now - 30 * DAY_MS).toISOString()
        : new Date(args.since).toISOString();

    const messages = await readMessages(
      context,
      args.campaign,
      since,
      args.max_messages
    );

    const paired = pair(messages);
    const hours = paired.pairs.map((each) => (each.at - each.sentAt) / HOUR_MS);

    const within = (limit: number): number | null =>
      rate(hours.filter((value) => value <= limit).length, hours.length);

    const received = messages.filter((message) => message.direction === "in");
    // A reply with no time cannot be placed after any send.
    const untimed = received.length - paired.replyTimes.length;

    const timing: ReplyTiming = {
      campaign: args.campaign,
      counts: {
        followOnReplies: paired.followOn,
        messagesRead: messages.length,
        paired: paired.pairs.length,
        received: received.length,
        sent: messages.length - received.length,
        unpaired: paired.unpaired + untimed,
      },
      replies: tableOf(paired.replyTimes, args.timezone_offset_minutes),
      sendsThatDrewReplies: tableOf(
        paired.pairs.map((each) => each.sentAt),
        args.timezone_offset_minutes
      ),
      since,
      timeToReply: {
        medianHours: round(median(hours)),
        p75Hours: round(percentile(hours, 0.75)),
        p90Hours: round(percentile(hours, 0.9)),
        sample: paired.pairs.length,
        within1Hour: within(1),
        within24Hours: within(24),
        within72Hours: within(72),
      },
      timezoneOffsetMinutes: args.timezone_offset_minutes,
    };

    return timing;
  },
});
