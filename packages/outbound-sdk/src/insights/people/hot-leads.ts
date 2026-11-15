// hot_leads: who to call first.

import { z } from "zod";

import type { Lead, ReplyCategory } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { plural } from "../../internal/plural.ts";
import { confirmCampaign } from "../campaign.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { round, total } from "../stats.ts";
import {
  isAutoReplied,
  isNegative,
  isPositive,
  nameOf,
  noteEngagement,
  positiveLabelsField,
  readByRef,
} from "./read.ts";

const DAY = 86_400_000;

/** The most recent replies read to find replied leads the lead listing missed. */
const RECENT_REPLIES = 100;

/** Reply categories that do not make a lead worth calling. */
const NOT_ENGAGED: ReadonlySet<ReplyCategory> = new Set<ReplyCategory>([
  "bounce",
  "ooo",
  "unsubscribe",
]);

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
      "The most leads to read and score. A vendor request returns about 50 to 100 leads. When more exist, the leads behind recent replies are read as well, so engaged leads past the cap are still ranked."
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
     * `true` when `max_leads` stopped the lead listing with more leads left:
     * those were not scored, except the ones found through recent replies.
     */
    readonly moreLeadsExist: boolean;
    /** Leads past the cap, read because they replied within `recency_days`. Counted in `leadsRead`. */
    readonly fromReplies: number;
    /** Leads the vendor labels out-of-office or bounced, whose replies earned no points. */
    readonly autoReplied: number;
    /** Leads the vendor labels negative, such as not interested or wrong person, which earn no points at all and are listed after every lead with a score above 0. A label in `positive_labels` is not counted here. */
    readonly negative: number;
  };
}

const capped = (
  count: number | null,
  points: number,
  cap: number
): number | null => (count === null ? null : Math.min(count, cap) * points);

/**
 * A person the vendor labels negative, who asked not to hear more: nothing
 * they did earns points. A label the caller lists as positive is not.
 */
const saidNo = (lead: Lead, labels: readonly string[]): boolean =>
  !isAutoReplied(lead) &&
  isNegative(lead) &&
  isPositive(lead.interest, labels) !== true;

/**
 * Replies that earn nothing: an automatic one (out-of-office, bounce), the
 * way dropped_replies leaves those out, or one from a person who said no.
 */
const repliesDiscounted = (lead: Lead, labels: readonly string[]): boolean =>
  isAutoReplied(lead) || saidNo(lead, labels);

const partsOf = (lead: Lead, values: Input, now: number): HotLeadParts => {
  const engagement = lead.engagement ?? null;
  const positive = isPositive(lead.interest, values.positive_labels);
  const automatic = repliesDiscounted(lead, values.positive_labels);
  // A click or open from a person who said no earns nothing either.
  const unwanted = saidNo(lead, values.positive_labels);

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

  return {
    clicks: capped(
      engagement?.clicks ?? null,
      unwanted ? 0 : values.weight_click,
      values.count_cap
    ),
    interest:
      positive === null ? null : Number(positive) * values.weight_interest,
    opens: capped(
      engagement?.opens ?? null,
      unwanted ? 0 : values.weight_open,
      values.count_cap
    ),
    recency:
      automatic && counted !== null
        ? 0
        : round(fresh === null ? null : fresh * values.weight_recency),
    replies: capped(replies, values.weight_reply, values.count_cap),
  };
};

/** Names the label that made the lead's replies, or everything it did, earn nothing. */
const discountedReason = (lead: Lead): string =>
  isAutoReplied(lead)
    ? `marked ${lead.interest ?? "out of office"}, so replies earn nothing`
    : `marked ${lead.interest ?? "not interested"}, so it earns no points`;

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
  labels: readonly string[]
): string => {
  const engagement = lead.engagement ?? null;
  const automatic = repliesDiscounted(lead, labels);
  const repliedAt = automatic ? null : (engagement?.lastRepliedAt ?? null);

  const facts = [
    (parts.interest ?? 0) > 0 ? `marked ${lead.interest}` : null,
    automatic ? discountedReason(lead) : null,
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

const toHotLead = (lead: Lead, values: Input, now: number): HotLead[] => {
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
          reason: reasonOf(lead, parts, now, values.positive_labels),
          replies: lead.engagement?.replies ?? null,
          score: round(score) ?? 0,
          status: lead.status,
          title: lead.title,
        },
      ];
};

interface LeadsRead {
  readonly leads: readonly Lead[];
  /** `true` when `max_leads` stopped the listing with more leads left. */
  readonly capped: boolean;
}

const listLeads = async (
  context: InsightContext,
  { campaign, max_leads: maxLeads }: Input
): Promise<LeadsRead> => {
  const { outbound } = context;

  if (campaign === null && !outbound.capabilities["leads.list"]) {
    throw new OutboundError(
      "Unsupported",
      `hot_leads needs a campaign here: the ${outbound.provider} adapter cannot list every lead (leads.list)`,
      { provider: outbound.provider }
    );
  }

  const walk =
    campaign === null
      ? outbound.leads.listAll({ max: maxLeads })
      : outbound.campaign(campaign).leads.listAll({ max: maxLeads });

  const leads = await context.all(walk, {
    input: "max_leads",
    max: maxLeads,
    what: campaign === null ? "leads" : "leads of a campaign",
  });

  // An unknown campaign lists no leads, which would read as nobody engaged.
  if (campaign !== null && leads.length === 0) {
    await confirmCampaign(context, campaign);
  }

  return { capped: walk.truncated, leads };
};

/**
 * The leads past the cap that replied within `recency_days`, newest replies
 * first, at most `limit` of them. A lead listing comes in the vendor's order,
 * not by engagement, so a cap can cut off exactly the leads worth calling.
 */
const repliedPastCap = async (
  context: InsightContext,
  values: Input,
  read: readonly Lead[]
): Promise<Lead[]> => {
  const { outbound } = context;

  if (
    !(
      outbound.capabilities["replies.list"] &&
      outbound.capabilities["leads.get"]
    )
  ) {
    context.note(
      "This tool cannot list replies or read one lead, so leads past max_leads that replied were not looked for."
    );

    return [];
  }

  const since = context.now - values.recency_days * DAY;
  const filtered = outbound.capabilities["replies.since"] !== false;
  const range = filtered ? { since: new Date(since).toISOString() } : {};

  const replies = await context.all(
    outbound.replies.listAll({ max: RECENT_REPLIES, ...range }),
    {
      input: null,
      max: RECENT_REPLIES,
      what: "recent replies looked through for leads past max_leads",
    }
  );

  const listed = new Set(read.map((lead) => lead.ref));

  const refs = replies
    .filter(
      (reply) =>
        reply.isAuto !== true &&
        !NOT_ENGAGED.has(reply.category) &&
        reply.sentAt !== null &&
        Date.parse(reply.sentAt) >= since &&
        (values.campaign === null || reply.campaignRef === values.campaign)
    )
    .toSorted((left, right) =>
      (right.sentAt ?? "").localeCompare(left.sentAt ?? "")
    )
    .flatMap((reply) =>
      reply.leadRef === null || listed.has(reply.leadRef) ? [] : [reply.leadRef]
    );

  const found = await readByRef(
    context,
    [...new Set(refs)].slice(0, values.limit),
    (ids) => outbound.leads.getMany(ids),
    ["lead that replied", "leads that replied"],
    "scores are missing"
  );

  return [...found.values()];
};

const repliesOf = (lead: Lead): number =>
  lead.engagement?.replies ?? (lead.replied === true ? 1 : 0);

const hottestFirst = (left: HotLead, right: HotLead): number =>
  right.score - left.score ||
  (right.lastRepliedAt ?? "").localeCompare(left.lastRepliedAt ?? "") ||
  left.lead.localeCompare(right.lead);

export const hotLeads = defineInsight({
  description:
    "Who to call first: leads ranked by a score built from what the vendor reports, namely a positive interest label, replies, clicks, opens and how recent the last reply is. Every score comes with its parts, and the weights are inputs. A lead with no label and no engagement data is left out and counted in totals.withoutData, never scored 0; unsubscribed and bounced leads are left out too. Give a campaign ref to rank one campaign (an unknown one is refused with NotFound), or none to rank every lead the tool lists. A lead the vendor labels out-of-office or bounced (its interest category, or a label reading out of office) earns no reply or recency points, since a vendor's reply count may include automatic replies; a lead it labels negative (the negative or unsubscribe category, or a label reading not interested, wrong person, unsubscribed or do not contact) earns no points at all, from clicks and opens either, and is listed after every lead with a score above 0 while limit leaves room; its reason names the label. Costs one request per page of leads read (max_leads sets the ceiling). When max_leads stops the listing with more leads left, totals.moreLeadsExist is true and it also reads up to 100 replies from the last recency_days days and one request per replied lead the listing missed, at most limit of them, so engaged leads past the cap are still ranked. A part that is null means the vendor does not report that signal.",
  inputSchema: input,
  key: "hotLeads",
  name: "hot_leads",
  needs: [],
  next: "Use person_summary with a lead's ref, email address or LinkedIn profile to read the conversation before calling.",
  run: async (context, values) => {
    const listed = await listLeads(context, values);

    const extra = listed.capped
      ? await repliedPastCap(context, values, listed.leads)
      : [];

    const leads = [...listed.leads, ...extra];

    noteEngagement(
      context,
      leads,
      "scores rest on the interest label and the lead's status"
    );

    const open = leads.filter(
      (lead) => lead.unsubscribed !== true && lead.bounced !== true
    );

    const scored = open.flatMap((lead) => toHotLead(lead, values, context.now));

    const hot = scored.filter((lead) => lead.score > 0).toSorted(hottestFirst);

    const negative = open.filter((lead) =>
      saidNo(lead, values.positive_labels)
    );

    // Leads who said no score 0 and fill what room `limit` leaves.
    const refused = new Set(negative.map((lead) => lead.ref));
    const after = scored
      .filter((lead) => lead.score <= 0 && refused.has(lead.lead))
      .toSorted(hottestFirst);

    const answer: HotLeads = {
      leads: [...hot, ...after].slice(0, values.limit),
      totals: {
        autoReplied: open.filter(
          (lead) => isAutoReplied(lead) && repliesOf(lead) > 0
        ).length,
        excluded: leads.length - open.length,
        fromReplies: extra.length,
        hot: hot.length,
        moreLeadsExist: listed.capped,
        negative: negative.length,
        leadsRead: leads.length,
        scored: scored.length,
        withoutData: open.length - scored.length,
      },
    };

    return answer;
  },
});
