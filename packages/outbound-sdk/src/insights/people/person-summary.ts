// person_summary: everything about one person across campaigns and channels.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Lead, Message } from "../../internal/entities.ts";
import {
  identifierCoverage,
  linksOf,
  undeterminedNote,
} from "../../internal/identifiers.ts";
import {
  checkPerson,
  personFields,
  personOf,
} from "../../tools/person-input.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rate } from "../stats.ts";
import { findPerson, refNeedsRead } from "./find.ts";
import { isAutoReplied } from "./read.ts";
import { recordsMeetings, threadContext } from "./thread-context.ts";
import type { ThreadContext } from "./thread-context.ts";

const input = z
  .object({
    max_campaigns: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe(
        "The most campaigns to report on. Each costs up to 2 requests."
      ),
    ...personFields,
  })
  .superRefine(checkPerson);

/**
 * The thread's context fields (`activity`, `meeting`, `vendorSentiment`,
 * `followUp`) are always set by person_summary; optional so a value built
 * by hand stays valid.
 */
export interface PersonCampaign extends Partial<ThreadContext> {
  readonly campaign: string | null;
  readonly campaignName: string | null;
  readonly campaignStatus: string | null;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
  readonly lead: string;
  /**
   * The lead's status, agreeing with `replied`: when the vendor says
   * `replied` only because of automatic replies, this is where the lead is in
   * the sequence instead, and `vendorLeadStatus` keeps the vendor's word.
   */
  readonly leadStatus: string;
  /** The lead's status as the vendor's record gives it, before automatic replies are set aside. */
  readonly vendorLeadStatus: string;
  /** The vendor's own label, for example `Interested`. */
  readonly interest: string | null;
  readonly messagesSent: number;
  /** Replies from the person, not counting replies flagged automatic. 0 when `autoReplied`. */
  readonly replies: number;
  readonly replied: boolean;
  /**
   * `true` when the vendor labels the lead out-of-office or bounced, or when
   * every reply in the thread is flagged automatic (by the vendor or a fixed
   * rule): its replies are not counted as the person replying.
   */
  readonly autoReplied: boolean;
  /** Steps the person replied to, counted from 0. Empty when the vendor does not tie a reply to a step. */
  readonly repliedStepIndexes: readonly number[];
  /** `repliedStepIndexes` counted from 1, as a person counts: `[2]` is the second email. */
  readonly repliedStepNumbers: readonly number[];
  /** @deprecated Use `repliedStepIndexes` (the same values, counted from 0) or `repliedStepNumbers`. Removed in 0.8.0. */
  readonly repliedSteps: readonly number[];
  /** The last step sent, counted from 0. */
  readonly lastStepIndex: number | null;
  /** `lastStepIndex` counted from 1, as a person counts. */
  readonly lastStepNumber: number | null;
  /** @deprecated Use `lastStepIndex` (the same value, counted from 0) or `lastStepNumber`. Removed in 0.8.0. */
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

/** A received message flagged automatic, by the vendor or by a fixed rule. */
const isAutoMessage = (message: Message): boolean =>
  message.direction === "in" && message.isAuto === true;

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

  const received = times(
    messages.filter((message) => !isAutoMessage(message)),
    "in"
  );

  const automatic = messages.filter(isAutoMessage).length;
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
    automatic,
    // A vendor that keeps no thread still counts replies on the lead, and
    // that count can include the automatic replies the thread holds.
    replies: Math.max(received.length, (counted?.replies ?? 0) - automatic),
    threadIsShort: sent.length < (counted?.stepIndex ?? -1) + 1,
  };
};

/** Says which automatic replies were not counted. */
const noteAutomatic = (
  context: InsightContext,
  lead: Lead,
  replies: number,
  flagged: number
): void => {
  if (isAutoReplied(lead)) {
    if (replies > 0) {
      context.note(
        "A record the vendor labels out-of-office or bounced had replies; they were automatic, so they are not counted as replies."
      );
    }
  } else if (flagged > 0) {
    context.note(
      "A record's thread held replies flagged automatic, by the vendor or by a fixed rule; they are not counted as replies."
    );
  }
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

  const { automatic, threadIsShort, ...counted } = activityOf(lead, messages);

  // The same rule hot_leads uses: an automatic reply is not the person
  // replying, whether the vendor labels the lead or flags the replies.
  const autoReplied =
    isAutoReplied(lead) || (automatic > 0 && counted.replies === 0);

  const activity = autoReplied
    ? { ...counted, lastRepliedAt: null, replies: 0 }
    : counted;

  noteAutomatic(context, lead, counted.replies + automatic, automatic);

  if (threadIsShort) {
    context.note(
      "A thread held fewer sent messages than the lead's last step, so messages sent is counted from the last step."
    );
  }

  const steps = autoReplied
    ? []
    : repliedSteps(
        lead,
        messages.filter((message) => !isAutoMessage(message))
      );

  return {
    ...activity,
    ...threadContext({
      lead,
      meetingsRecorded: recordsMeetings(outbound),
      messages,
      now: context.now,
      provider: lead.provider,
    }),
    campaign: lead.campaignRef,
    campaignName: campaign?.name ?? null,
    campaignStatus: campaign?.status ?? null,
    channel: campaign?.channel ?? (lead.email === null ? "linkedin" : "email"),
    interest: lead.interest,
    lead: lead.ref,
    // The vendor's "replied" can count an out-of-office; the person did not reply.
    leadStatus:
      autoReplied && lead.status === "replied" ? lead.progress : lead.status,
    provider: lead.provider,
    autoReplied,
    replied: !autoReplied && (activity.replies > 0 || lead.replied === true),
    lastStepIndex: activity.lastStep,
    lastStepNumber: activity.lastStep === null ? null : activity.lastStep + 1,
    repliedStepIndexes: steps,
    repliedStepNumbers: steps.map((index) => index + 1),
    repliedSteps: steps,
    vendorLeadStatus: lead.status,
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
    "Everything about one person across campaigns and channels, from one of lead_ref (a lead ref exactly as another tool returned it), email, linkedin_url, or person (any of the three): each campaign they are in, how many messages they were sent, whether and how often they replied, which steps they replied to, their interest label, and totals by channel. Records are linked by exact identifier only, so an email finds a LinkedIn record only when a tool holds both for that person. A record the vendor labels out-of-office or bounced counts no replies, since they were automatic, and a reply in the thread flagged automatic (isAuto, from the vendor or a fixed rule) is not counted either. Each campaign counts the messages of its own campaign only, and the totals add the campaigns up; cross_channel_lead lists every message once across campaigns and tools, automatic replies included. A tool that fills none of the person's identifier types (an Instantly lead has no LinkedIn profile unless leadFields maps one) cannot be searched for them, so the answer is marked incomplete and a note names it. A lead ref from a tool or workspace the instance does not read is refused before any request. Costs one lookup per identifier, one request to read a lead ref whose id is not already an address or profile (a HeyReach ref needs none), then up to 2 requests per campaign. Each campaign also carries its conversation's context: activity (the latest message, who sent it and when), meeting (what the vendor records on the lead, Instantly only), vendorSentiment (the vendor's labels, kept apart) and followUp, a fixed-rule assessment whose needed is true only when the latest message is inbound, not automatic and no meeting is recorded, with its evidence and what it could not check.",
  inputSchema: input,
  key: "personSummary",
  cost: (values, price) =>
    (refNeedsRead(personOf(values))
      ? price.one("leads.get") +
        price.upTo(2) * price.lookup(values.max_campaigns)
      : price.lookup(values.max_campaigns) +
        price.upTo(1) * price.lookup(values.max_campaigns)) +
    price.upTo(values.max_campaigns) *
      (price.one("campaigns.get") + price.walk("messages.list")),
  scales: "max_campaigns",
  name: "person_summary",
  needs: ["leads.lookup", "leads.timeline"],
  needsFor: (values) => (refNeedsRead(personOf(values)) ? ["leads.get"] : []),
  next: "Use account_summary with their email domain to see everyone at the same company.",
  run: async (context, values) => {
    const maxCampaigns = values.max_campaigns;
    const found = await findPerson(context, personOf(values), maxCampaigns);
    const timelines: Timelines = new Map();

    const campaigns = await mapConcurrent(found.records, (lead) =>
      summarize(context, timelines, lead)
    );

    const contacted = campaigns.filter((entry) => entry.messagesSent > 0);
    const replied = campaigns.filter((entry) => entry.replied);

    const links = linksOf(
      await identifierCoverage(context.outbound),
      found.keys,
      found.records
    );

    for (const link of links) {
      if (link.status === "undetermined") {
        context.partial(undeterminedNote(link));
      }
    }

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
