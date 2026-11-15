// campaign_diagnosis: why one campaign is underperforming. Reads what the
// adapter can serve about it and runs the checks in diagnosis-checks.ts.

import { z } from "zod";

import type { CampaignSettings } from "../../internal/entities-account.ts";
import type { Sender } from "../../internal/entities.ts";
import { readCapped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { total } from "../stats.ts";
import { diagnose, unknownRates } from "./diagnosis-checks.ts";
import type {
  DiagnosisFinding,
  Facts,
  RecentSends,
} from "./diagnosis-checks.ts";
import {
  labelOf,
  lastDays,
  rangeFields,
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
  daily_limit_share: share(
    0.9,
    "Average daily sends at or over this share of the daily limit mean the limit holds volume back"
  ),
  max_bounce_rate: share(0.03, "A bounce rate over this is a finding"),
  max_send_drop: share(
    0.3,
    "A fall in sends, recent days against the days before, over this share is a finding"
  ),
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("The most senders of the campaign to read"),
  min_positive_share: share(
    0.2,
    "A share of replies that are positive under this is a finding"
  ),
  min_reply_rate: share(0.01, "A reply rate under this is a finding"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(100)
    .describe("Under this many sends, rates are not judged"),
  min_weekly_hours: z
    .number()
    .min(0)
    .max(168)
    .default(20)
    .describe("Sending windows open fewer hours a week than this limit volume"),
  recent_days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe(
      "The days, ending yesterday, held against the same number before"
    ),
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

  return {
    before: total(sentIn(before.from, before.to)),
    days,
    daysWithData: sends.filter((value) => value !== null).length,
    sent: total(sends),
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

const summarize = (findings: readonly DiagnosisFinding[]): string => {
  const [first] = findings;

  return first === undefined
    ? "No problem was found in what could be checked."
    : `${findings.length} ${findings.length === 1 ? "finding" : "findings"}. Most serious: ${first.finding}`;
};

export const campaignDiagnosis = defineInsight({
  description:
    "Why one campaign is underperforming: a list of findings, most serious first, each with a code, a plain-language finding, the numbers behind it and what to look at next. It checks for too little volume to judge, a low reply rate (with its 95% interval), a high bounce rate, few positive replies among replies, sends falling or stopped over the last days, a one or two step sequence, a sender that is not active, open tracking being off, and a schedule or daily limit that holds volume back. Also returns what could not be checked; an empty list means nothing was found, not that all is well. Costs up to 7 requests.",
  inputSchema: input,
  key: "campaignDiagnosis",
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
      recentDays: options.recent_days,
    });

    const facts: Facts = {
      ...extras,
      campaign,
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
