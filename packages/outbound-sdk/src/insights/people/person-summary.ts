// person_summary: everything about one person across campaigns and channels.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead, Message } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rate } from "../stats.ts";
import { findPerson } from "./find.ts";

const input = z.object({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("The most campaigns to report on. Each costs up to 2 requests."),
  person: z
    .string()
    .min(3)
    .describe("The person's email address or LinkedIn profile URL"),
});

export interface PersonCampaign {
  readonly campaign: string | null;
  readonly campaignName: string | null;
  readonly campaignStatus: string | null;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
  readonly lead: string;
  readonly leadStatus: string;
  /** The vendor's own label, for example `Interested`. */
  readonly interest: string | null;
  readonly messagesSent: number;
  /** Replies from the person. 0 when the vendor labels the lead out-of-office or bounced. */
  readonly replies: number;
  readonly replied: boolean;
  /**
   * `true` when the vendor labels the lead out-of-office or bounced: its
   * replies were automatic, so they are not counted as the person replying.
   */
  readonly autoReplied: boolean;
  /** Steps the person replied to, counted from 0. Empty when the vendor does not tie a reply to a step. */
  readonly repliedSteps: readonly number[];
  /** The last step sent, counted from 0. */
  readonly lastStep: number | null;
  readonly firstContactedAt: string | null;
  readonly lastContactedAt: string | null;
  readonly lastRepliedAt: string | null;
}

export interface PersonSummary {
  readonly found: boolean;
  /** Every exact identifier the records carry, as `email:` or `linkedin:` keys. */
  readonly identifiers: readonly string[];
  readonly campaigns: readonly PersonCampaign[];
  readonly totals: {
    readonly campaigns: number;
    readonly campaignsReplied: number;
    /** Campaigns they replied in, divided by campaigns that sent them at least one message. */
    readonly campaignReplyRate: number | null;
    readonly messagesSent: number;
    readonly replies: number;
    readonly byChannel: Readonly<
      Record<
        string,
        { readonly messagesSent: number; readonly replies: number }
      >
    >;
  };
}

const times = (messages: readonly Message[], direction: "in" | "out") =>
  messages.flatMap((message) =>
    message.direction === direction && message.sentAt !== null
      ? [message.sentAt]
      : []
  );

/**
 * The step each reply answers: the reply's own step when the vendor gives it
 * one, otherwise the last step sent before it; plus the step the vendor names
 * on the lead.
 */
const repliedSteps = (lead: Lead, messages: readonly Message[]): number[] => {
  const steps = new Set<number>();
  let lastSent: number | null = null;

  for (const message of messages) {
    if (message.direction === "out") {
      lastSent = message.stepIndex ?? lastSent;
    } else if ((message.stepIndex ?? lastSent) !== null) {
      steps.add(message.stepIndex ?? lastSent ?? 0);
    }
  }

  const named = lead.engagement?.repliedStepIndex ?? null;

  if (named !== null) {
    steps.add(named);
  }

  return [...steps].toSorted((left, right) => left - right);
};

/** Counts and times from the thread, falling back to what the vendor counts on the lead. */
const activityOf = (lead: Lead, messages: readonly Message[]) => {
  const sent = times(messages, "out");
  const received = times(messages, "in");
  const counted = lead.engagement;

  return {
    firstContactedAt: sent[0] ?? null,
    lastContactedAt: sent.at(-1) ?? counted?.lastContactedAt ?? null,
    lastRepliedAt: received.at(-1) ?? counted?.lastRepliedAt ?? null,
    lastStep:
      counted?.stepIndex ??
      messages.findLast(
        (message) => message.direction === "out" && message.stepIndex !== null
      )?.stepIndex ??
      null,
    // A vendor's thread can hold fewer messages than were sent; the last
    // step sent (counted from 0) is then the better count.
    messagesSent: Math.max(sent.length, (counted?.stepIndex ?? -1) + 1),
    // A vendor that keeps no thread still counts replies on the lead.
    replies: Math.max(received.length, counted?.replies ?? 0),
    threadIsShort: sent.length < (counted?.stepIndex ?? -1) + 1,
  };
};

/** Each lead's whole timeline, read once even when it is in several campaigns. */
type Timelines = Map<string, Promise<readonly Message[]>>;

/** A lead's messages in this record's campaign. */
const timelineOf = async (
  context: InsightContext,
  timelines: Timelines,
  lead: Lead
): Promise<readonly Message[]> => {
  let all = timelines.get(lead.ref);

  if (all === undefined) {
    // The read is shared while it is in flight, so records read side by side
    // still ask for one lead's timeline once.
    all = context.outbound
      .lead(lead.ref)
      .timeline()
      .then((page) => context.page(page));
    timelines.set(lead.ref, all);
  }

  const messages = await all;

  // A vendor that uses one lead id in every campaign returns every campaign's
  // messages; keep this record's own.
  return messages.filter(
    (message) =>
      message.campaignRef === null ||
      lead.campaignRef === null ||
      message.campaignRef === lead.campaignRef
  );
};

const summarize = async (
  context: InsightContext,
  timelines: Timelines,
  lead: Lead
): Promise<PersonCampaign> => {
  const { outbound } = context;

  const [messages, campaign] = await Promise.all([
    timelineOf(context, timelines, lead),
    lead.campaignRef === null
      ? null
      : outbound.campaigns.get(lead.campaignRef).then(context.one),
  ]);

  const { threadIsShort, ...counted } = activityOf(lead, messages);

  // The same rule hot_leads uses: an automatic reply is not the person replying.
  const autoReplied = isAutoReplied(lead);

  const activity = autoReplied
    ? { ...counted, lastRepliedAt: null, replies: 0 }
    : counted;

  if (autoReplied && counted.replies > 0) {
    context.note(
      "A record the vendor labels out-of-office or bounced had replies; they were automatic, so they are not counted as replies."
    );
  }

  if (threadIsShort) {
    context.note(
      "A thread held fewer sent messages than the lead's last step, so messages sent is counted from the last step."
    );
  }

  return {
    ...activity,
    campaign: lead.campaignRef,
    campaignName: campaign?.name ?? null,
    campaignStatus: campaign?.status ?? null,
    channel: campaign?.channel ?? (lead.email === null ? "linkedin" : "email"),
    interest: lead.interest,
    lead: lead.ref,
    leadStatus: lead.status,
    provider: lead.provider,
    autoReplied,
    replied: !autoReplied && (activity.replies > 0 || lead.replied === true),
    repliedSteps: autoReplied ? [] : repliedSteps(lead, messages),
  };
};

const byChannel = (campaigns: readonly PersonCampaign[]) => {
  const channels: Record<string, { messagesSent: number; replies: number }> =
    {};

  for (const campaign of campaigns) {
    const before = channels[campaign.channel] ?? {
      messagesSent: 0,
      replies: 0,
    };

    channels[campaign.channel] = {
      messagesSent: before.messagesSent + campaign.messagesSent,
      replies: before.replies + campaign.replies,
    };
  }

  return channels;
};

export const personSummary = defineInsight({
  description:
    "Everything about one person across campaigns and channels, from their email address or LinkedIn profile: each campaign they are in, how many messages they were sent, whether and how often they replied, which steps they replied to, their interest label, and totals by channel. Records are linked by exact identifier only, so an email finds a LinkedIn record only when a tool holds both for that person. Costs one lookup per identifier, then up to 2 requests per campaign.",
  inputSchema: input,
  key: "personSummary",
  name: "person_summary",
  needs: ["leads.lookup", "leads.timeline"],
  next: "Use account_summary with their email domain to see everyone at the same company.",
  run: async (context, { max_campaigns: maxCampaigns, person }) => {
    const found = await findPerson(context, person, maxCampaigns);
    const timelines: Timelines = new Map();

    const campaigns = await mapConcurrent(found.records, (lead) =>
      summarize(context, timelines, lead)
    );

    const contacted = campaigns.filter((entry) => entry.messagesSent > 0);
    const replied = campaigns.filter((entry) => entry.replied);

    const summary: PersonSummary = {
      campaigns,
      found: campaigns.length > 0,
      identifiers: found.keys,
      totals: {
        byChannel: byChannel(campaigns),
        campaignReplyRate: rate(
          contacted.filter((entry) => entry.replied).length,
          contacted.length
        ),
        campaigns: campaigns.length,
        campaignsReplied: replied.length,
        messagesSent: campaigns.reduce(
          (sum, entry) => sum + entry.messagesSent,
          0
        ),
        replies: campaigns.reduce((sum, entry) => sum + entry.replies, 0),
      },
    };

    return summary;
  },
});
