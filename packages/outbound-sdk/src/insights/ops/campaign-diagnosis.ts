// campaign_diagnosis: why one campaign is underperforming. Reads what the
// adapter can serve about it and runs the checks in diagnosis-checks.ts.

import { z } from "zod";

import type { CampaignSettings } from "../../internal/entities-account.ts";
import type { Campaign, Sender } from "../../internal/entities.ts";
import {
  leadsToStart,
  newLeadsPerDay,
  runwayOf,
  splitActive,
} from "../../internal/runway.ts";
import { SCREENED_AT_MOST } from "../../internal/sender-screen.ts";
import { readCapped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { total } from "../stats.ts";
import {
  diagnose,
  sendsFellOrStopped,
  unknownRates,
} from "./diagnosis-checks.ts";
import type {
  DiagnosisFinding,
  Facts,
  LeadsLeft,
  RecentSends,
} from "./diagnosis-checks.ts";
import { readRunwayLeads } from "./pipeline-forecast.ts";
import {
  labelOf,
  lastDays,
  ratesOf,
  readDaily,
  readTotals,
  totalsOf,
} from "./shared.ts";
import type { CampaignLabel, OpenRange, Rates, Totals } from "./shared.ts";
import {
  canCountSkipped,
  skippedFields,
  skippedLimits,
} from "./skipped-leads.ts";

const share = (fallback: number, text: string) =>
  z.number().min(0).max(1).default(fallback).describe(text);

const input = z.object({
  ...rangeFields,
  campaign: z.string().min(3).describe("The campaign's ref or name"),
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe(
      "The days, ending yesterday, held against the same number before"
    ),
  daily_limit_share: share(
    0.9,
    "Average daily sends at or over this share of the daily limit mean the limit holds volume back"
  ),
  max_bounce_rate: share(0.03, "A bounce rate over this is a finding"),
  ...skippedFields,
  max_send_drop: share(
    0.3,
    "A fall in sends, recent days against the days before, over this share is a finding"
  ),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(2000)
    .describe(
      "The most leads to read when sends fell or stopped, to tell lead runout from a fault. Where the tool lists active leads alone (leads.byStatus), only those are read. A page of leads is one request."
    ),
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(SCREENED_AT_MOST)
    .default(SCREENED_AT_MOST)
    .describe(
      "The most of the campaign's own senders to read and screen for a status that is not active or a warmup score of 0"
    ),
  min_positive_share: share(
    0.2,
    "A share of replies that are positive under this is a finding"
  ),
  min_reply_rate: share(0.01, "A reply rate under this is a finding"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(50)
    .describe("Under this many sends, rates are not judged"),
  min_weekly_hours: z
    .number()
    .min(0)
    .max(168)
    .default(20)
    .describe("Sending windows open fewer hours a week than this limit volume"),
});

export interface CampaignDiagnosis extends CampaignLabel {
  readonly period: OpenRange;
  readonly totals: Totals;
  readonly rates: Rates;
  /** Most serious first. Empty when nothing was found in what could be checked. */
  readonly findings: readonly DiagnosisFinding[];
  /** What could not be checked, and why. */
  readonly notChecked: readonly string[];
  readonly summary: string;
}

interface Extras {
  readonly settings: CampaignSettings | null;
  readonly steps: number | null;
  readonly senders: readonly Sender[] | null;
  readonly recent: RecentSends | null;
  readonly campaignLeads: number | null;
  readonly skippedLeads: number | null;
  readonly notChecked: string[];
}

const readRecent = async (
  context: InsightContext,
  campaign: string,
  days: number
): Promise<RecentSends> => {
  const recent = lastDays(context.now, days);
  const before = lastDays(context.now, days, 1);

  const series = await readDaily(context, campaign, {
    from: before.from,
    to: recent.to,
  });

  const sentIn = (from: string, to: string): (number | null)[] =>
    series.flatMap((day) =>
      day.date >= from && day.date <= to ? [day.counts.sent] : []
    );

  const sends = sentIn(recent.from, recent.to);

  // The recent window is the pace window lead_runway and pipeline_forecast
  // use: the `days` complete days ending yesterday.
  const started = newLeadsPerDay(
    series.flatMap((day) =>
      day.date >= recent.from && day.date <= recent.to ? [day.counts] : []
    ),
    days
  );

  return {
    before: total(sentIn(before.from, before.to)),
    days,
    daysWithData: sends.filter((value) => value !== null).length,
    sent: total(sends),
    startedPerDay: started,
  };
};

/** The leads left, or why lead runout was not checked. */
interface LeadsRead {
  readonly leads: LeadsLeft | null;
  /** Set when lead runout could not be checked, for `notChecked`. */
  readonly notChecked?: string;
}

/**
 * The leads left to start, read only to tell lead runout from a fault, and
 * only the active leads where the tool lists them alone, the read
 * client_report counts its runway from. `leads` is `null` when the adapter
 * cannot list them, the cap stopped the read (the count would be a minimum,
 * so runout cannot be claimed) or a listing of every status is empty (a
 * campaign that sent has leads, so that says nothing; an empty listing of
 * active leads means none is left).
 */
const readLeadsLeft = async (
  context: InsightContext,
  campaign: Campaign,
  recent: RecentSends,
  maxLeads: number
): Promise<LeadsRead> => {
  if (!context.outbound.capabilities["leads.byCampaign"]) {
    const why =
      "Lead runout: the adapter cannot list a campaign's leads, so a fall in sends was not checked against the leads left.";

    context.note(why);

    return { leads: null, notChecked: why };
  }

  const read = await readRunwayLeads(context, campaign, {
    activeOnly: true,
    leadsInput: "max_leads",
    leadsWhat: "leads",
    maxLeads,
  });

  if (read.capped) {
    return {
      leads: null,
      notChecked: `Lead runout: max_leads (${maxLeads}) stopped the read of the campaign's ${read.activeOnly ? "active " : ""}leads before all were counted, so a fall in sends was not checked against the leads left. Raise max_leads to check it.`,
    };
  }

  if (read.items.length === 0 && !read.activeOnly) {
    return { leads: null };
  }

  const split = splitActive(read.items);
  const unknown = read.items.filter((lead) => lead.status === "unknown").length;

  const runway = runwayOf(split, { unknown }, true, recent.startedPerDay);

  // A campaign that stopped because none is left to start has run out now, whether or not it started any lately.
  return {
    leads: {
      active: split.active,
      daysLeft: runway.state === "out_of_leads" ? 0 : runway.daysLeft,
      inSequence: split.inSequence,
      toStart: leadsToStart(split),
    },
  };
};

/** The reads that only improve the answer. Each is skipped, and named, when the adapter cannot serve it. */
const readExtras = async (
  context: InsightContext,
  campaign: string,
  options: { readonly maxSenders: number; readonly recentDays: number }
): Promise<Extras> => {
  const { capabilities } = context.outbound;
  const handle = context.outbound.campaign(campaign);
  const notChecked: string[] = [];

  const unless = (missing: boolean, what: string): boolean => {
    if (missing) {
      notChecked.push(what);
      context.note(what);
    }

    return !missing;
  };

  const settings = unless(
    !capabilities["campaigns.settings"],
    "Schedule and tracking: the adapter does not serve campaign settings."
  )
    ? context.one(await handle.settings())
    : null;

  const steps = unless(
    !capabilities.sequence,
    "Sequence length: the adapter does not serve sequences."
  )
    ? context.one(await handle.sequence()).steps.length
    : null;

  const senders = unless(
    !capabilities["senders.byCampaign"],
    "Sender status: the adapter cannot list a campaign's senders."
  )
    ? await readCapped(context, (max) => handle.senders.listAll({ max }), {
        input: "max_senders",
        max: options.maxSenders,
        what: "senders",
      })
    : null;

  const progress = unless(
    !capabilities["campaigns.progress"],
    "Leads contacted against the campaign's leads: the adapter does not serve campaign progress."
  )
    ? context.one(await handle.progress())
    : null;

  // A null count with progress read is the adapter's to explain, in its note.
  unless(
    progress !== null && !canCountSkipped(context),
    "Skipped leads: the adapter does not report how many of a campaign's leads were skipped."
  );

  const recent = unless(
    capabilities["stats.byDay"] === false,
    "Recent sending trend: the adapter has no stats by day."
  )
    ? await readRecent(context, campaign, options.recentDays)
    : null;

  return {
    campaignLeads: progress?.leads ?? null,
    notChecked,
    recent,
    senders: senders?.items ?? null,
    settings,
    skippedLeads: progress?.skipped ?? null,
    steps,
  };
};

const leadsIfSendsFell = async (
  context: InsightContext,
  campaign: Campaign,
  recent: RecentSends | null,
  options: { readonly maxLeads: number; readonly maxSendDrop: number }
): Promise<LeadsRead> =>
  recent !== null &&
  sendsFellOrStopped(campaign, recent, { maxSendDrop: options.maxSendDrop })
    ? await readLeadsLeft(context, campaign, recent, options.maxLeads)
    : { leads: null };

const summarize = (findings: readonly DiagnosisFinding[]): string => {
  const [first] = findings;

  return first === undefined
    ? "No problem was found in what could be checked."
    : `${findings.length} ${findings.length === 1 ? "finding" : "findings"}. Most serious: ${first.finding}`;
};

export const campaignDiagnosis = defineInsight({
  description:
    "Why one campaign is underperforming: findings, most serious first, each with a code, the numbers behind it and what to look at next. It checks volume, the reply, bounce and positive rates, sends falling or stopped (told apart from running out of leads), sequence length, its own senders' status and warmup, tracking, schedule and daily limit, a leads-contacted count that cannot be right, and many skipped leads. It also lists what could not be checked. Costs up to 7 requests, plus pages of leads not contacted where skipped leads are listed, of senders and, when sends fell, of active leads.",
  inputSchema: input,
  key: "campaignDiagnosis",
  cost: (values, price) => {
    const { capabilities } = price;

    return (
      price.one("campaigns.get") +
      price.one("stats") +
      (capabilities["campaigns.settings"] === false
        ? 0
        : price.one("campaigns.settings")) +
      (capabilities["campaigns.progress"] === false
        ? 0
        : price.one("campaigns.progress")) +
      (capabilities.sequence === false ? 0 : price.one("sequence.get")) +
      (capabilities["senders.byCampaign"] === false
        ? 0
        : price.campaignSenders(values.max_senders)) +
      (capabilities["stats.byDay"] === false ? 0 : price.one("stats")) +
      // The leads are read only when sends fell or stopped, which the data decides.
      (capabilities["stats.byDay"] === false ||
      capabilities["leads.byCampaign"] === false
        ? 0
        : price.upTo(1) * price.list("leads.list", values.max_leads))
    );
  },
  scales: "max_senders",
  name: "campaign_diagnosis",
  needs: ["stats.campaign"],
  next: "Follow the `next` of the first finding, for example bounce_watch, step_funnel or pipeline_forecast.",
  run: async (context, options) => {
    const campaign = context.one(
      await context.outbound.campaigns.get(options.campaign)
    );

    const counts = await readTotals(context, campaign.ref, options);

    const extras = await readExtras(context, campaign.ref, {
      maxSenders: options.max_senders,
      recentDays: options.days,
    });

    const { leads, notChecked: leadsNotChecked } = await leadsIfSendsFell(
      context,
      campaign,
      extras.recent,
      {
        maxLeads: options.max_leads,
        maxSendDrop: options.max_send_drop,
      }
    );

    const facts: Facts = {
      ...extras,
      campaign,
      leads,
      opened: counts.opened,
      rates: ratesOf(counts),
      totals: totalsOf(counts),
    };

    const findings = diagnose(facts, {
      ...skippedLimits(options),
      dailyLimitShare: options.daily_limit_share,
      maxBounceRate: options.max_bounce_rate,
      maxSendDrop: options.max_send_drop,
      minPositiveShare: options.min_positive_share,
      minReplyRate: options.min_reply_rate,
      minSent: options.min_sent,
      minWeeklyHours: options.min_weekly_hours,
    });

    const diagnosis: CampaignDiagnosis = {
      ...labelOf(campaign),
      findings,
      notChecked: [
        ...extras.notChecked,
        ...(leadsNotChecked === undefined ? [] : [leadsNotChecked]),
        ...unknownRates(facts),
      ],
      period: { from: options.from, to: options.to },
      rates: facts.rates,
      summary: summarize(findings),
      totals: facts.totals,
    };

    return diagnosis;
  },
});
