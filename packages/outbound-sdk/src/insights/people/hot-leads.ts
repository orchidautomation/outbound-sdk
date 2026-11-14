// hot_leads: who to call first.

import { z } from "zod";

import type { Lead } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { round, total } from "../stats.ts";
import {
  isPositive,
  leadsOf,
  nameOf,
  positiveLabelsField,
  readCapped,
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
      "The most leads to read and score. A vendor request returns about 50 to 100 leads."
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
  /** Highest score first, then most recent reply. Only leads that scored above 0. */
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
  };
}

const capped = (
  count: number | null,
  points: number,
  cap: number
): number | null => (count === null ? null : Math.min(count, cap) * points);

const partsOf = (lead: Lead, values: Input, now: number): HotLeadParts => {
  const engagement = lead.engagement ?? null;
  const positive = isPositive(lead.interest, values.positive_labels);

  // A vendor that only sets the status still says the lead replied once.
  const replies = engagement?.replies ?? (lead.status === "replied" ? 1 : null);

  const repliedAt = engagement?.lastRepliedAt ?? null;

  const age =
    repliedAt === null
      ? null
      : Math.max(0, now - Date.parse(repliedAt)) / DAY / values.recency_days;

  return {
    clicks: capped(
      engagement?.clicks ?? null,
      values.weight_click,
      values.count_cap
    ),
    interest:
      positive === null ? null : Number(positive) * values.weight_interest,
    opens: capped(
      engagement?.opens ?? null,
      values.weight_open,
      values.count_cap
    ),
    recency:
      age === null ? null : round(Math.max(0, 1 - age) * values.weight_recency),
    replies: capped(replies, values.weight_reply, values.count_cap),
  };
};

const reasonOf = (lead: Lead, parts: HotLeadParts, now: number): string => {
  const engagement = lead.engagement ?? null;
  const repliedAt = engagement?.lastRepliedAt ?? null;

  const facts = [
    (parts.interest ?? 0) > 0 ? `marked ${lead.interest}` : null,
    (parts.replies ?? 0) > 0
      ? `replied ${engagement?.replies ?? 1} time(s)`
      : null,
    repliedAt === null
      ? null
      : `last reply ${Math.floor(Math.max(0, now - Date.parse(repliedAt)) / DAY)} day(s) ago`,
    (parts.clicks ?? 0) > 0 ? `${engagement?.clicks} click(s)` : null,
    (parts.opens ?? 0) > 0 ? `${engagement?.opens} open(s)` : null,
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
          reason: reasonOf(lead, parts, now),
          replies: lead.engagement?.replies ?? null,
          score: round(score) ?? 0,
          status: lead.status,
          title: lead.title,
        },
      ];
};

const readLeads = (
  context: InsightContext,
  { campaign, max_leads: maxLeads }: Input
): Promise<Lead[]> => {
  const { outbound } = context;

  if (campaign !== null) {
    return leadsOf(context, campaign, maxLeads);
  }

  if (!outbound.capabilities["leads.list"]) {
    throw new OutboundError(
      "Unsupported",
      `hot_leads needs a campaign here: the ${outbound.provider} adapter cannot list every lead (leads.list)`,
      { provider: outbound.provider }
    );
  }

  return readCapped(
    context,
    (cap) => outbound.leads.listAll({ max: cap }),
    maxLeads,
    "leads"
  );
};

const hottestFirst = (left: HotLead, right: HotLead): number =>
  right.score - left.score ||
  (right.lastRepliedAt ?? "").localeCompare(left.lastRepliedAt ?? "") ||
  left.lead.localeCompare(right.lead);

export const hotLeads = defineInsight({
  description:
    "Who to call first: leads ranked by a score built from what the vendor reports, namely a positive interest label, replies, clicks, opens and how recent the last reply is. Every score comes with its parts, and the weights are inputs. A lead with no label and no engagement data is left out and counted in totals.withoutData, never scored 0; unsubscribed and bounced leads are left out too. Give a campaign ref to rank one campaign, or none to rank every lead the tool lists. Costs one request per page of leads read (max_leads sets the ceiling). A part that is null means the vendor does not report that signal.",
  inputSchema: input,
  key: "hotLeads",
  name: "hot_leads",
  needs: [],
  next: "Use person_summary with a lead's email address or LinkedIn profile to read the conversation before calling.",
  run: async (context, values) => {
    if (!context.outbound.capabilities["leads.engagement"]) {
      context.note(
        "This tool reports no per-lead open, click or reply counts, so scores rest on the interest label and the lead's status."
      );
    }

    const leads = await readLeads(context, values);

    const open = leads.filter(
      (lead) => lead.status !== "unsubscribed" && lead.status !== "bounced"
    );

    const scored = open.flatMap((lead) => toHotLead(lead, values, context.now));

    const hot = scored.filter((lead) => lead.score > 0).toSorted(hottestFirst);

    const answer: HotLeads = {
      leads: hot.slice(0, values.limit),
      totals: {
        excluded: leads.length - open.length,
        hot: hot.length,
        leadsRead: leads.length,
        scored: scored.length,
        withoutData: open.length - scored.length,
      },
    };

    return answer;
  },
});
