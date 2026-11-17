// Thread context for reply and follow-up results: the latest message in a
// conversation, the meeting the vendor records, the vendor's own sentiment
// kept apart, and a follow-up assessment from fixed rules. No model reads a
// message and no rule reads its words: the rules look at who sent the latest
// message and when, and at what the vendor records, and they say what they
// could not check.

import type {
  Lead,
  MeetingStatus,
  Message,
  ReplyCategory,
} from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import type { OutboundApi } from "../../internal/outbound/api.ts";

const HOUR = 3_600_000;

/** A wait as a person says it: in hours under two days, in whole days after. */
export const waited = (hours: number): string =>
  hours >= 48
    ? plural(Math.floor(hours / 24), "day")
    : plural(Math.floor(hours), "hour");

/** The newest message of a conversation, without its body. */
export type LatestMessage = Omit<Message, "bodyHtml" | "bodyText">;

/** Who wrote last in a conversation, and when, from the messages read. */
export interface ThreadActivity {
  /** Messages read in the conversation. 0 when it was not read. */
  readonly messagesRead: number;
  /** The newest message with a time. `null` when none was read. */
  readonly latest: LatestMessage | null;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
}

/** What the vendor says about interest, kept apart from the follow-up assessment. */
export interface VendorSentiment {
  /** The vendor's category on the reply the result is about. `null` when it is not about one. */
  readonly replyCategory: ReplyCategory | null;
  /** The vendor's label on the lead, such as `Interested`. */
  readonly leadLabel: string | null;
  /** What `leadLabel` means, in reply categories. */
  readonly leadCategory: ReplyCategory | null;
}

/**
 * The rule that decided `needed`: `answered` (the latest message is
 * outbound), `meeting` (the vendor records a meeting booked, held or won),
 * `inbound_unanswered` (the latest message is inbound and not automatic),
 * `automatic` (the latest message is an automatic reply), `no_messages` (the
 * conversation read holds none with a time), `not_read` (it was not read).
 */
export type FollowUpBasis =
  | "answered"
  | "automatic"
  | "inbound_unanswered"
  | "meeting"
  | "no_messages"
  | "not_read";

export interface FollowUpAssessment {
  /**
   * `true` when the latest message is inbound, not automatic and the vendor
   * records no meeting; `false` when the latest message is outbound or the
   * vendor records a meeting; `null` when the rules cannot tell. A vendor
   * label alone never sets it.
   */
  readonly needed: boolean | null;
  readonly basis: FollowUpBasis;
  /** The facts the rules used, as sentences. */
  readonly evidence: readonly string[];
  /** What the rules could not check, as sentences. */
  readonly unchecked: readonly string[];
}

export interface ThreadContext {
  readonly activity: ThreadActivity;
  /** The meeting the vendor records on the lead. `null` when it records none or the lead was not read. */
  readonly meeting: MeetingStatus | null;
  readonly vendorSentiment: VendorSentiment;
  readonly followUp: FollowUpAssessment;
}

/** The reply a result is about, when the vendor labelled it. */
export interface LabelledReply {
  readonly ref: string;
  readonly category: ReplyCategory;
  readonly sentAt: string | null;
}

export interface ThreadFacts {
  /** The conversation's messages, in any order. `null` when it was not read. */
  readonly messages: readonly Message[] | null;
  /** Why the conversation was not read. */
  readonly notRead?: string | undefined;
  /** The lead record. `null` when it was not read or there is none. */
  readonly lead: Lead | null;
  readonly provider: string;
  /** `false` where the vendor records no meeting on a lead. */
  readonly meetingsRecorded: boolean;
  readonly labelled?: LabelledReply | null | undefined;
  readonly now: number;
}

/** `false` where the adapter never fills a lead's `meeting`. */
export const recordsMeetings = (outbound: OutboundApi): boolean =>
  outbound.fields.lead?.meeting !== false;

const timeOf = (message: Message): number =>
  message.sentAt === null ? Number.NaN : Date.parse(message.sentAt);

const lastAt = (
  messages: readonly Message[],
  direction: "in" | "out"
): string | null =>
  messages.findLast((message) => message.direction === direction)?.sentAt ??
  null;

export const withoutBody = ({
  bodyHtml: _html,
  bodyText: _text,
  ...rest
}: Message): LatestMessage => rest;

export const activityOf = (
  messages: readonly Message[] | null
): ThreadActivity => {
  const timed = (messages ?? [])
    .filter((message) => !Number.isNaN(timeOf(message)))
    .toSorted((left, right) => timeOf(left) - timeOf(right));

  const newest = timed.at(-1);

  return {
    lastInboundAt: lastAt(timed, "in"),
    lastOutboundAt: lastAt(timed, "out"),
    latest: newest === undefined ? null : withoutBody(newest),
    messagesRead: messages?.length ?? 0,
  };
};

const MEETING_WORDS: Readonly<Record<MeetingStatus, string>> = {
  booked: "booked",
  completed: "held",
  no_show: "missed (no-show)",
  won: "won",
};

/** A time for a sentence, to the minute: `2026-11-12 09:30 UTC`. */
const shown = (at: string | null): string =>
  at === null
    ? "at an unknown time"
    : `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;

const hoursSince = (at: string, now: number): number =>
  Math.max(0, now - Date.parse(at)) / HOUR;

/** What the latest message is, as a sentence. */
const latestSentence = (latest: LatestMessage, now: number): string => {
  const ago = waited(hoursSince(latest.sentAt ?? "", now));

  if (latest.direction === "out") {
    return `The latest message is outbound, sent ${ago} ago (${shown(latest.sentAt)}).`;
  }

  return latest.isAuto === true
    ? `The latest message is an automatic reply, received ${ago} ago (${shown(latest.sentAt)}).`
    : `The latest message is inbound and unanswered for ${ago} (received ${shown(latest.sentAt)}).`;
};

/** A sentence when the vendor's label is on an earlier reply than the latest message. */
const labelSentence = (
  labelled: LabelledReply | null | undefined,
  latest: LatestMessage
): string[] => {
  if (
    labelled === null ||
    labelled === undefined ||
    labelled.ref === latest.ref ||
    labelled.sentAt === null ||
    latest.sentAt === null
  ) {
    return [];
  }

  const gap = waited(
    Math.max(0, Date.parse(latest.sentAt) - Date.parse(labelled.sentAt)) / HOUR
  );

  return [
    `The vendor's ${labelled.category} label is on an earlier reply (${shown(labelled.sentAt)}), ${gap} before the latest message, so it may not describe the conversation now.`,
  ];
};

interface Found {
  readonly evidence: string[];
  readonly unchecked: string[];
}

const meetingFacts = (facts: ThreadFacts): Found => {
  const { lead, provider } = facts;

  if (!facts.meetingsRecorded) {
    return {
      evidence: [],
      unchecked: [
        `Whether a meeting was booked: ${provider} records no meeting status on a lead.`,
      ],
    };
  }

  if (lead === null) {
    return {
      evidence: [],
      unchecked: ["Whether a meeting was booked: the lead was not read."],
    };
  }

  const meeting = lead.meeting ?? null;

  return {
    evidence: [
      meeting === null
        ? `${provider} records no meeting for the lead.`
        : `${provider} records the lead's meeting as ${MEETING_WORDS[meeting]}.`,
    ],
    unchecked: [],
  };
};

const tagsUnchecked = (lead: Lead | null): string[] =>
  lead === null || lead.tags.length === 0
    ? []
    : [
        `The lead's tags (${lead.tags.join(", ")}) were not interpreted; a tag can record a meeting or a decision the rules do not read.`,
      ];

const READ_IT =
  "What the messages say: the rules read who wrote last and when, never the words, so read the latest message before acting.";

const decide = (
  latest: LatestMessage,
  meeting: MeetingStatus | null
): Pick<FollowUpAssessment, "basis" | "needed"> => {
  if (meeting !== null && meeting !== "no_show") {
    return { basis: "meeting", needed: false };
  }

  if (latest.direction === "out") {
    return { basis: "answered", needed: false };
  }

  return latest.isAuto === true
    ? { basis: "automatic", needed: null }
    : { basis: "inbound_unanswered", needed: true };
};

export const assessFollowUp = (
  facts: ThreadFacts,
  activity: ThreadActivity
): FollowUpAssessment => {
  const meeting = meetingFacts(facts);
  const tags = tagsUnchecked(facts.lead);

  if (facts.messages === null) {
    return {
      basis: "not_read",
      evidence: meeting.evidence,
      needed: null,
      unchecked: [
        `The conversation was not read${facts.notRead === undefined ? "" : ` (${facts.notRead})`}, so who wrote last is unknown; a vendor label alone does not show a reply is owed.`,
        ...meeting.unchecked,
        ...tags,
      ],
    };
  }

  const { latest } = activity;

  if (latest === null) {
    return {
      basis: "no_messages",
      evidence: meeting.evidence,
      needed: null,
      unchecked: [
        "Who wrote last: the conversation read holds no message with a time.",
        ...meeting.unchecked,
        ...tags,
      ],
    };
  }

  return {
    ...decide(latest, facts.lead?.meeting ?? null),
    evidence: [
      latestSentence(latest, facts.now),
      ...labelSentence(facts.labelled, latest),
      ...meeting.evidence,
    ],
    unchecked: [READ_IT, ...meeting.unchecked, ...tags],
  };
};

/** Activity, meeting, vendor sentiment and the follow-up assessment of one conversation. */
export const threadContext = (facts: ThreadFacts): ThreadContext => {
  const activity = activityOf(facts.messages);

  return {
    activity,
    followUp: assessFollowUp(facts, activity),
    meeting: facts.lead?.meeting ?? null,
    vendorSentiment: {
      leadCategory: facts.lead?.interestCategory ?? null,
      leadLabel: facts.lead?.interest ?? null,
      replyCategory: facts.labelled?.category ?? null,
    },
  };
};
