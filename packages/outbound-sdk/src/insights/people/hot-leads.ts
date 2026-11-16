// hot_leads: who to call first.

import { z } from "zod";

import type { Lead } from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { defineInsight } from "../define.ts";
import { round, total } from "../stats.ts";
import { autoOnlyRefs } from "./auto-replies.ts";
import { readCandidates } from "./hot-leads-read.ts";
import {
  isAutoReplied,
  isNegative,
  isPositive,
  nameOf,
  noteEngagement,
  positiveLabelsField,
} from "./read.ts";

const DAY = 86_400_000;

const weight = (value: number, what: string) =>
  z.number().min(0).default(value).describe(what);

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "A campaign ref (provider:workspace:id) to rank the leads of. Null ranks every lead the tool lists."
    ),
  count_cap: z
    .number()
    .int()
    .min(1)
    .default(5)
    .describe(
      "The most replies, clicks or opens that earn points, so 40 opens do not outrank a reply"
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(20)
    .describe("How many leads to return"),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(500)
    .describe(
      "The most leads a lead listing reads: the leads labelled positive where the tool filters by interest, and the lead list itself where it cannot or include_engagement_only is true. A vendor request returns about 50 to 100 leads. The leads behind replies within recency_days are read on top."
    ),
  max_replies: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(1000)
    .describe(
      "The most replies within recency_days to read: a safety ceiling, not a sample. A vendor request returns about 100 replies."
    ),
  max_age_days: z
    .number()
    .min(1)
    .default(90)
    .describe(
      "A positive interest label earns its full points while the last reply is within recency_days, fading evenly to none at this many days, and a lead whose last reply is older ranks after every lead with a fresher one. A label with no reply time keeps its points."
    ),
  include_engagement_only: z
    .boolean()
    .default(false)
    .describe(
      "Also walk the lead list up to max_leads, to rank leads whose only signal is opens or clicks. Where the tool cannot filter leads by interest the list is walked anyway."
    ),
  positive_labels: positiveLabelsField,
  recency_days: z
    .number()
    .min(1)
    .default(14)
    .describe(
      "A reply today earns the full recency points, fading evenly to none after this many days"
    ),
  weight_click: weight(5, "Points for each click, up to count_cap"),
  weight_interest: weight(50, "Points for carrying a positive interest label"),
  weight_open: weight(1, "Points for each open, up to count_cap"),
  weight_recency: weight(20, "Points for a reply received right now"),
  weight_reply: weight(10, "Points for each reply, up to count_cap"),
});

type Input = z.infer<typeof input>;

/** The input, plus whether a lead's replies were automatic. */
interface Scoring extends Input {
  /** The vendor labels the lead out-of-office or bounced, or every reply read was automatic. */
  readonly automatic: (lead: Lead) => boolean;
}

/** Points per signal. `null` when the vendor reports nothing for that signal. */
export interface HotLeadParts {
  readonly interest: number | null;
  readonly replies: number | null;
  readonly clicks: number | null;
  readonly opens: number | null;
  readonly recency: number | null;
}

export interface HotLead {
  readonly lead: string;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly name: string | null;
  readonly title: string | null;
  readonly company: string | null;
  readonly campaign: string | null;
  readonly status: string;
  readonly interest: string | null;
  /** The sum of the known parts. */
  readonly score: number;
  readonly parts: HotLeadParts;
  readonly replies: number | null;
  readonly clicks: number | null;
  readonly opens: number | null;
  readonly lastRepliedAt: string | null;
  readonly reason: string;
}

export interface HotLeads {
  /**
   * Highest score first, then most recent reply: the leads that scored above
   * 0, then, while `limit` leaves room, the leads labelled negative, which
   * score 0.
   */
  readonly leads: readonly HotLead[];
  readonly totals: {
    readonly leadsRead: number;
    /** Leads with at least one known signal. */
    readonly scored: number;
    /** Scored leads with a score above 0, before `limit`. */
    readonly hot: number;
    /** Leads the vendor reports no label and no engagement for. Left out, not scored 0. */
    readonly withoutData: number;
    /** Unsubscribed or bounced leads, left out. */
    readonly excluded: number;
    /**
     * `true` when `max_leads` stopped a lead listing with more leads left:
     * those were not scored, except the ones found through their replies.
     */
    readonly moreLeadsExist: boolean;
    /** Replies within `recency_days` read. */
    readonly repliesRead: number;
    /** Leads no listing read, read because they replied within `recency_days`. Counted in `leadsRead`. */
    readonly fromReplies: number;
    /** Leads that replied within `recency_days` and could not be read, probably deleted. Not scored. */
    readonly unreadable: number;
    /** Leads with a score above 0 whose last reply is older than `max_age_days`, listed after every fresher one. */
    readonly stale: number;
    /**
     * Leads with replies that earned no points because they were automatic:
     * the vendor labels the lead out-of-office or bounced, or every reply of
     * the lead read was flagged automatic.
     */
    readonly autoReplied: number;
    /** Leads the vendor labels negative, such as not interested or wrong person, which earn no points at all and are listed after every lead with a score above 0. A label in `positive_labels` is not counted here. */
    readonly negative: number;
  };
}

/**
 * Whether the lead's label is one of `positive_labels`. A lead with no label
 * whose vendor still classes it positive (HeyReach's auto-tag, read from its
 * replies) counts as positive; with no label and no such class it is unknown.
 */
const positiveOf = (lead: Lead, values: Input): boolean | null =>
  lead.interest === null
    ? lead.interestCategory === "positive" || null
    : isPositive(lead.interest, values.positive_labels);

const capped = (
  count: number | null,
  points: number,
  cap: number
): number | null => (count === null ? null : Math.min(count, cap) * points);

/**
 * A person the vendor labels negative, who asked not to hear more: nothing
 * they did earns points. A label the caller lists as positive is not.
 */
const saidNo = (lead: Lead, values: Scoring): boolean =>
  !values.automatic(lead) &&
  isNegative(lead) &&
  isPositive(lead.interest, values.positive_labels) !== true;

/**
 * Replies that earn nothing: an automatic one (out-of-office, bounce), the
 * way dropped_replies leaves those out, or one from a person who said no.
 */
const repliesDiscounted = (lead: Lead, values: Scoring): boolean =>
  values.automatic(lead) || saidNo(lead, values);

/** Points for clicks and opens. A person who said no earns none from either. */
const engagementParts = (
  lead: Lead,
  values: Scoring
): Pick<HotLeadParts, "clicks" | "opens"> => {
  const unwanted = saidNo(lead, values);

  return {
    clicks: capped(
      lead.engagement?.clicks ?? null,
      unwanted ? 0 : values.weight_click,
      values.count_cap
    ),
    opens: capped(
      lead.engagement?.opens ?? null,
      unwanted ? 0 : values.weight_open,
      values.count_cap
    ),
  };
};

/** Days since the lead's last reply, automatic or not. `null` without a time. */
const ageOf = (lead: Lead, now: number): number | null => {
  const at = lead.engagement?.lastRepliedAt ?? null;

  return at === null ? null : Math.max(0, now - Date.parse(at)) / DAY;
};

/**
 * What share of its points an interest label keeps: all while the last reply
 * is within `recency_days`, fading evenly to none at `max_age_days`.
 */
const fade = (lead: Lead, values: Scoring, now: number): number => {
  const age = ageOf(lead, now);
  const span = values.max_age_days - values.recency_days;

  if (age === null || age <= values.recency_days) {
    return 1;
  }

  return span <= 0
    ? Number(age <= values.max_age_days)
    : Math.max(0, 1 - (age - values.recency_days) / span);
};

const partsOf = (lead: Lead, values: Scoring, now: number): HotLeadParts => {
  const engagement = lead.engagement ?? null;
  const positive = positiveOf(lead, values);
  const automatic = repliesDiscounted(lead, values);

  // A vendor that only sets the status still says the lead replied once.
  const counted = engagement?.replies ?? (lead.replied === true ? 1 : null);
  const replies = automatic && counted !== null ? 0 : counted;

  const repliedAt = automatic ? null : (engagement?.lastRepliedAt ?? null);

  const age =
    repliedAt === null
      ? null
      : Math.max(0, now - Date.parse(repliedAt)) / DAY / values.recency_days;

  // An automatic reply earns no recency either; without one the age decides.
  const fresh = age === null ? null : Math.max(0, 1 - age);

  const { clicks, opens } = engagementParts(lead, values);
  const faded = fade(lead, values, now);

  return {
    clicks,
    interest:
      positive === null
        ? null
        : round(Number(positive) * values.weight_interest * faded),
    opens,
    recency:
      automatic && counted !== null
        ? 0
        : round(fresh === null ? null : fresh * values.weight_recency),
    replies: capped(replies, values.weight_reply, values.count_cap),
  };
};

/** Names the label that made the lead's replies, or everything it did, earn nothing. */
const discountedReason = (lead: Lead, values: Scoring): string => {
  if (isAutoReplied(lead)) {
    return `marked ${lead.interest ?? "out of office"}, so replies earn nothing`;
  }

  return values.automatic(lead)
    ? "every reply read was automatic, so replies earn nothing"
    : `marked ${lead.interest ?? "not interested"}, so it earns no points`;
};

/** `2 clicks` when the count earned points, otherwise nothing. */
const counted = (
  points: number | null | undefined,
  amount: number | null | undefined,
  what: string
): string | null => ((points ?? 0) > 0 ? plural(amount ?? 0, what) : null);

const reasonOf = (
  lead: Lead,
  parts: HotLeadParts,
  now: number,
  values: Scoring
): string => {
  const engagement = lead.engagement ?? null;
  const automatic = repliesDiscounted(lead, values);
  const repliedAt = automatic ? null : (engagement?.lastRepliedAt ?? null);

  const facts = [
    (parts.interest ?? 0) > 0
      ? `marked ${lead.interest ?? "positive by the vendor"}`
      : null,
    automatic ? discountedReason(lead, values) : null,
    (parts.replies ?? 0) > 0
      ? `replied ${plural(engagement?.replies ?? 1, "time")}`
      : null,
    repliedAt === null
      ? null
      : `last reply ${plural(Math.floor(Math.max(0, now - Date.parse(repliedAt)) / DAY), "day")} ago`,
    counted(parts.clicks, engagement?.clicks, "click"),
    counted(parts.opens, engagement?.opens, "open"),
  ].flatMap((fact) => (fact === null ? [] : [fact]));

  return `${facts.join(", ")}.`;
};

const toHotLead = (lead: Lead, values: Scoring, now: number): HotLead[] => {
  const parts = partsOf(lead, values, now);
  const score = total(Object.values(parts));

  return score === null
    ? []
    : [
        {
          campaign: lead.campaignRef,
          clicks: lead.engagement?.clicks ?? null,
          company: lead.company,
          email: lead.email,
          interest: lead.interest,
          lastRepliedAt: lead.engagement?.lastRepliedAt ?? null,
          lead: lead.ref,
          linkedinUrl: lead.linkedinUrl,
          name: nameOf(lead),
          opens: lead.engagement?.opens ?? null,
          parts,
          reason: reasonOf(lead, parts, now, values),
          replies: lead.engagement?.replies ?? null,
          score: round(score) ?? 0,
          status: lead.status,
          title: lead.title,
        },
      ];
};

const repliesOf = (lead: Lead): number =>
  lead.engagement?.replies ?? (lead.replied === true ? 1 : 0);

const hottestFirst = (left: HotLead, right: HotLead): number =>
  right.score - left.score ||
  (right.lastRepliedAt ?? "").localeCompare(left.lastRepliedAt ?? "") ||
  left.lead.localeCompare(right.lead);

/** Leads whose last reply is older than `max_age_days`, listed after every fresher lead. */
const staleOf = (
  leads: readonly Lead[],
  values: Scoring,
  now: number
): ReadonlySet<string> =>
  new Set(
    leads.flatMap((lead) => {
      const age = ageOf(lead, now);

      return age !== null && age > values.max_age_days ? [lead.ref] : [];
    })
  );

export const hotLeads = defineInsight({
  description:
    "Who to call first: leads ranked by a score built from a positive interest label, replies, clicks, opens and how recent the last reply is. Every score comes with its parts, and the weights are inputs. Candidates come from the signal: every reply within recency_days (up to max_replies, a safety ceiling, so complete means complete for the window) and, where the tool filters leads by interest (leads.byInterest), the leads it labels positive, up to max_leads. Leads behind those replies that no listing read are then looked up, many addresses in one request where the tool can (leads.lookupMany), otherwise one request each for the newest limit of them; one that cannot be read is counted in totals.unreadable. Where the tool cannot filter by interest, or include_engagement_only is true, the lead list is walked too, up to max_leads, for leads whose only signal is opens or clicks; totals.moreLeadsExist says that cap left leads unread. A reply read in the window fills a lead's reply count and last reply time when its record reports less. A positive label keeps its points while the last reply is within recency_days and fades to nothing at max_age_days, and a lead whose last reply is older than that is listed after every fresher one (totals.stale). A lead with no label and no engagement data is left out and counted in totals.withoutData, never scored 0; unsubscribed and bounced leads are left out too. Give a campaign ref to rank one campaign (an unknown one is refused with NotFound), or none to rank every lead. A lead the vendor labels out-of-office or bounced earns no reply or recency points, and so does a lead whose every reply in the window is flagged automatic (isAuto, from the vendor or a fixed rule); both are counted in totals.autoReplied. A lead labelled negative (not interested, wrong person, unsubscribed, do not contact) earns no points at all and is listed after every lead with a score above 0 while limit leaves room; its reason names the label. While the redact plugin masks email addresses, which a reply can name its lead by, leads found only through a reply are not looked up, and under strategy 'mask' replies are not read at all; each says so in a note and marks the answer incomplete. A part that is null means the vendor does not report that signal.",
  inputSchema: input,
  key: "hotLeads",
  cost: (values, price) => {
    const { capabilities } = price;
    const filtered = capabilities["leads.byInterest"] === true;
    const replies = capabilities["replies.list"] !== false;

    return (
      (filtered ? price.list("leads.list", values.max_leads) : 0) +
      (!filtered || values.include_engagement_only
        ? price.list("leads.list", values.max_leads)
        : 0) +
      (values.campaign === null
        ? 0
        : price.upTo(1) * price.one("campaigns.get")) +
      (replies ? price.list("replies.list", values.max_replies) : 0) +
      (replies && capabilities["leads.lookupMany"] === true
        ? price.upTo(Math.ceil(values.max_replies / 100)) *
          price.list("leads.list", 100)
        : 0) +
      (replies && capabilities["leads.get"] !== false
        ? price.upTo(values.limit) * price.one("leads.get")
        : 0)
    );
  },
  scales: "max_replies",
  name: "hot_leads",
  needs: [],
  next: "Use person_summary with a lead's ref, email address or LinkedIn profile to read the conversation before calling.",
  run: async (context, values) => {
    const read = await readCandidates(context, values);
    const { leads } = read;

    if (read.replies === null) {
      noteEngagement(
        context,
        leads,
        "scores rest on the interest label and the lead's status"
      );
    } else {
      noteEngagement(
        context,
        leads,
        "those are unknown, and reply counts and recency come from the replies read within recency_days",
        "no per-lead open or click counts"
      );
    }

    const open = leads.filter(
      (lead) => lead.unsubscribed !== true && lead.bounced !== true
    );

    const autoOnly = autoOnlyRefs(
      read.replies ?? [],
      open.filter((lead) => !isAutoReplied(lead))
    );

    const scoring: Scoring = {
      ...values,
      automatic: (lead) => isAutoReplied(lead) || autoOnly.has(lead.ref),
    };

    const scored = open.flatMap((lead) =>
      toHotLead(lead, scoring, context.now)
    );

    const stale = staleOf(open, scoring, context.now);
    const positive = scored.filter((lead) => lead.score > 0);

    const hot = [
      ...positive
        .filter((lead) => !stale.has(lead.lead))
        .toSorted(hottestFirst),
      ...positive.filter((lead) => stale.has(lead.lead)).toSorted(hottestFirst),
    ];

    const negative = open.filter((lead) => saidNo(lead, scoring));

    // Leads who said no score 0 and fill what room `limit` leaves.
    const refused = new Set(negative.map((lead) => lead.ref));

    const after = scored
      .filter((lead) => lead.score <= 0 && refused.has(lead.lead))
      .toSorted(hottestFirst);

    const answer: HotLeads = {
      leads: [...hot, ...after].slice(0, values.limit),
      totals: {
        autoReplied: open.filter(
          (lead) => scoring.automatic(lead) && repliesOf(lead) > 0
        ).length,
        excluded: leads.length - open.length,
        fromReplies: read.fromReplies,
        hot: hot.length,
        leadsRead: leads.length,
        moreLeadsExist: read.moreLeadsExist,
        negative: negative.length,
        repliesRead: read.replies?.length ?? 0,
        scored: scored.length,
        stale: positive.filter((lead) => stale.has(lead.lead)).length,
        unreadable: read.unreadable,
        withoutData: open.length - scored.length,
      },
    };

    return answer;
  },
});
