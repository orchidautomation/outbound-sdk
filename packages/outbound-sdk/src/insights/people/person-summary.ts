// person_summary: everything about one person across campaigns and channels.

import { z } from "zod";

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
  readonly replies: number;
  readonly replied: boolean;
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

const summarize = async (
  context: InsightContext,
  lead: Lead
): Promise<PersonCampaign> => {
  const { outbound } = context;
  const messages = context.page(await outbound.lead(lead.ref).timeline());

  const campaign =
    lead.campaignRef === null
      ? null
      : context.one(await outbound.campaigns.get(lead.campaignRef));

  const { threadIsShort, ...activity } = activityOf(lead, messages);

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
    replied: activity.replies > 0 || lead.status === "replied",
    repliedSteps: repliedSteps(lead, messages),
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
    const campaigns: PersonCampaign[] = [];

    for (const lead of found.records) {
      // oxlint-disable-next-line no-await-in-loop -- one record at a time keeps the rate budget predictable.
      campaigns.push(await summarize(context, lead));
    }

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
