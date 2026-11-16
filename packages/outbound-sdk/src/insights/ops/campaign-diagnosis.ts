// campaign_diagnosis: why one campaign is underperforming. Reads what the
// adapter can serve about it and runs the checks in diagnosis-checks.ts.

import { z } from "zod";

import type { CampaignSettings } from "../../internal/entities-account.ts";
import type { Campaign, Sender } from "../../internal/entities.ts";
import {
  leadsToStart,
  newLeadsPerDay,
  runwayDays,
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
import {
  labelOf,
  lastDays,
  ratesOf,
  readDaily,
  readTotals,
  totalsOf,
} from "./shared.ts";
import type { CampaignLabel, OpenRange, Rates, Totals } from "./shared.ts";

const share = (fallback: number, text: string) =>
  z.number().min(0).max(1).default(fallback).describe(text);

const input = z.object({
  ...rangeFields,
  campaign: z.string().min(3).describe("The campaign's ref"),
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
      "The most leads to read when sends fell or stopped, to tell lead runout from a fault. A page of leads is one request."
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

/**
 * The leads left to start, read only to tell lead runout from a fault. `null`
 * when the adapter cannot list them, the cap stopped the read (the count would
 * be a minimum, so runout cannot be claimed) or the vendor lists none (a
 * campaign that sent has leads, so an empty listing says nothing).
 */
const readLeadsLeft = async (
  context: InsightContext,
  campaign: string,
  recent: RecentSends,
  maxLeads: number
): Promise<LeadsLeft | null> => {
  if (!context.outbound.capabilities["leads.byCampaign"]) {
    context.note(
      "Lead runout: the adapter cannot list a campaign's leads, so a fall in sends was not checked against the leads left."
    );

    return null;
  }

  const { capped, items: leads } = await readCapped(
    context,
    (max) => context.outbound.campaign(campaign).leads.listAll({ max }),
    { input: "max_leads", max: maxLeads, what: "leads" }
  );

  if (capped || leads.length === 0) {
    return null;
  }

  const split = splitActive(leads);
  const unknown = leads.filter((lead) => lead.status === "unknown").length;

  return {
    active: split.active,
    daysLeft: runwayDays(split, { unknown }, true, recent.startedPerDay),
    inSequence: split.inSequence,
    toStart: leadsToStart(split),
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

  const recent = unless(
    capabilities["stats.byDay"] === false,
    "Recent sending trend: the adapter has no stats by day."
  )
    ? await readRecent(context, campaign, options.recentDays)
    : null;

  return {
    notChecked,
    recent,
    senders: senders?.items ?? null,
    settings,
    steps,
  };
};

const leadsIfSendsFell = async (
  context: InsightContext,
  campaign: Campaign,
  recent: RecentSends | null,
  options: { readonly maxLeads: number; readonly maxSendDrop: number }
): Promise<LeadsLeft | null> =>
  recent !== null &&
  sendsFellOrStopped(campaign, recent, { maxSendDrop: options.maxSendDrop })
    ? await readLeadsLeft(context, campaign.ref, recent, options.maxLeads)
    : null;

const summarize = (findings: readonly DiagnosisFinding[]): string => {
  const [first] = findings;

  return first === undefined
    ? "No problem was found in what could be checked."
    : `${findings.length} ${findings.length === 1 ? "finding" : "findings"}. Most serious: ${first.finding}`;
};

export const campaignDiagnosis = defineInsight({
  description:
    "Why one campaign is underperforming: a list of findings, most serious first, each with a code, a plain-language finding, the numbers behind it and what to look at next. It checks for too little volume to judge, a low reply rate (with its 95% interval), a high bounce rate, few positive replies among replies, sends falling or stopped over the last days, told apart from the campaign running out of leads (under a day of new leads left to start at the recent pace, the pace lead_runway uses), a one or two step sequence, any of the campaign's own senders (up to 500) that is not active or has a warmup score of 0, open or click tracking being off, and a schedule or daily limit that holds volume back. Also returns what could not be checked; an empty list means nothing was found, not that all is well. Costs up to 6 requests, plus one per page of the campaign's senders and, only when sends fell or stopped, one per page of its leads.",
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
      (capabilities.sequence === false ? 0 : price.one("sequence.get")) +
      (capabilities["senders.byCampaign"] === false
        ? 0
        : price.list("senders.list", values.max_senders)) +
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

    const leads = await leadsIfSendsFell(context, campaign, extras.recent, {
      maxLeads: options.max_leads,
      maxSendDrop: options.max_send_drop,
    });

    const facts: Facts = {
      ...extras,
      campaign,
      leads,
      opened: counts.opened,
      rates: ratesOf(counts),
      totals: totalsOf(counts),
    };

    const findings = diagnose(facts, {
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
      notChecked: [...extras.notChecked, ...unknownRates(facts)],
      period: { from: options.from, to: options.to },
      rates: facts.rates,
      summary: summarize(findings),
      totals: facts.totals,
    };

    return diagnosis;
  },
});
