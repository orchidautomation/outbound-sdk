// period_comparison: the last N days against the N days before.

import { z } from "zod";

import type { Campaign, CampaignStatus } from "../../internal/entities.ts";
import { sumCounts } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { compareRates, round } from "../stats.ts";
import type { ProportionTest } from "../stats.ts";
import {
  descending,
  labelOf,
  lastDays,
  listFields,
  percent,
  ratesOf,
  readCampaigns,
  readTotals,
  totalsOf,
  volumeOf,
} from "./shared.ts";
import type { CampaignLabel, DayRange, Totals } from "./shared.ts";

const input = z.object({
  ...listFields("two stats requests"),
  alpha: z
    .number()
    .gt(0)
    .lt(1)
    .default(0.05)
    .describe("The p-value under which a change counts as more than chance"),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe("The length of each period, in complete days ending yesterday"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(50)
    .describe(
      "A campaign under this many sends in either period is listed apart"
    ),
});

/** Counts and rates for one period, or the change between two. `null` is unknown. */
export interface PeriodNumbers extends Totals {
  readonly replyRate: number | null;
  readonly positiveRate: number | null;
  readonly bounceRate: number | null;
}

export interface Comparison {
  readonly current: PeriodNumbers;
  readonly previous: PeriodNumbers;
  /** `current` minus `previous`, field by field. Rates change in points: 0.02 is two points. */
  readonly change: PeriodNumbers;
  /** The two-proportion test on the reply rate. `null` when it cannot be run. */
  readonly replyRateTest: ProportionTest | null;
  /** Whether the reply rate moved by more than chance. */
  readonly verdict: "down" | "no_real_change" | "unknown" | "up";
  readonly finding: string;
}

export interface CampaignComparison extends CampaignLabel, Comparison {}

export interface ThinCampaign extends CampaignLabel {
  readonly currentSent: number | null;
  readonly previousSent: number | null;
}

export interface PeriodComparison {
  readonly days: number;
  readonly current: DayRange;
  readonly previous: DayRange;
  /** Largest change in reply rate first. */
  readonly campaigns: readonly CampaignComparison[];
  readonly tooFewSends: readonly ThinCampaign[];
  /** Every campaign read, added together. */
  readonly total: Comparison;
  /** The vendor's own workspace totals. `null` when the adapter has none. */
  readonly workspace: Comparison | null;
}

const numbersOf = (counts: Totals): PeriodNumbers => {
  const rates = ratesOf(counts);

  return {
    ...totalsOf(counts),
    bounceRate: rates.bounceRate.rate,
    positiveRate: rates.positiveRate.rate,
    replyRate: rates.replyRate.rate,
  };
};

const minus = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : round(current - previous);

const changeOf = (
  current: PeriodNumbers,
  previous: PeriodNumbers
): PeriodNumbers => ({
  bounceRate: minus(current.bounceRate, previous.bounceRate),
  bounced: minus(current.bounced, previous.bounced),
  contacted: minus(current.contacted, previous.contacted),
  positive: minus(current.positive, previous.positive),
  positiveRate: minus(current.positiveRate, previous.positiveRate),
  replied: minus(current.replied, previous.replied),
  replyRate: minus(current.replyRate, previous.replyRate),
  sent: minus(current.sent, previous.sent),
});

const verdictOf = (test: ProportionTest | null): Comparison["verdict"] => {
  if (test === null) {
    return "unknown";
  }

  if (!test.significant) {
    return "no_real_change";
  }

  return test.z > 0 ? "up" : "down";
};

/** Compares two periods of counts: both sides, the change, and whether the reply rate really moved. */
export const comparePeriods = (
  current: Totals,
  previous: Totals,
  alpha: number
): Comparison => {
  const now = ratesOf(current).replyRate;
  const before = ratesOf(previous).replyRate;

  const test = compareRates(
    { successes: now.count, trials: now.of },
    { successes: before.count, trials: before.of },
    alpha
  );

  const moved = `Reply rate went from ${percent(before.rate)} to ${percent(now.rate)}`;

  return {
    change: changeOf(numbersOf(current), numbersOf(previous)),
    current: numbersOf(current),
    finding:
      test === null
        ? "Reply rate cannot be compared: a period has no reply or volume counts, or neither has a reply."
        : `${moved}; ${
            test.significant
              ? "more than chance"
              : "within what chance would give"
          } (p = ${test.pValue}).`,
    previous: numbersOf(previous),
    replyRateTest: test,
    verdict: verdictOf(test),
  };
};

export interface CampaignPeriods {
  readonly campaign: Campaign;
  readonly current: MetricCounts;
  readonly previous: MetricCounts;
}

export interface Periods {
  readonly current: DayRange;
  readonly previous: DayRange;
  readonly campaigns: readonly CampaignPeriods[];
}

/** Each campaign's totals for the last `days` and the `days` before: two stats requests per campaign. */
export const readPeriods = async (
  context: InsightContext,
  options: {
    readonly days: number;
    readonly max_campaigns: number;
    readonly statuses: readonly CampaignStatus[];
  }
): Promise<Periods> => {
  const current = lastDays(context.now, options.days);
  const previous = lastDays(context.now, options.days, 1);
  const campaigns: CampaignPeriods[] = [];

  const found = await readCampaigns(
    context,
    options.statuses,
    options.max_campaigns
  );

  for (const campaign of found) {
    campaigns.push({
      campaign,
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      current: await readTotals(context, campaign.ref, current),
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      previous: await readTotals(context, campaign.ref, previous),
    });
  }

  return { campaigns, current, previous };
};

/** Every campaign's two periods added together. */
export const totalOf = (
  campaigns: readonly CampaignPeriods[],
  alpha: number
): Comparison =>
  comparePeriods(
    sumCounts(campaigns.map((entry) => entry.current)),
    sumCounts(campaigns.map((entry) => entry.previous)),
    alpha
  );

const workspaceOf = async (
  context: InsightContext,
  periods: Periods,
  alpha: number
): Promise<Comparison | null> => {
  const { outbound } = context;

  if (outbound.capabilities["stats.workspace"] === false) {
    context.note(
      "Workspace totals were left out: the adapter has no workspace stats. `total` adds up the campaigns read."
    );

    return null;
  }

  const current = context.rows(await outbound.stats(periods.current));
  const previous = context.rows(await outbound.stats(periods.previous));

  return comparePeriods(sumCounts(current), sumCounts(previous), alpha);
};

export const periodComparison = defineInsight({
  description:
    "This period against the last: for each campaign, counts and rates for the last `days` complete days and for the `days` before, the change in each, and whether the change in reply rate is more than chance (a two-proportion test), with the campaigns sorted by the size of that change. Also the same for every campaign added together and, where the adapter has them, for the vendor's workspace totals. Use it for a weekly review. Campaigns under min_sent sends in either period are listed apart; a null is a count the vendor does not report. Costs two stats requests per campaign plus two for the workspace.",
  inputSchema: input,
  key: "periodComparison",
  name: "period_comparison",
  needs: ["stats.campaign"],
  next: "Use campaign_diagnosis on the campaign whose reply rate fell the most.",
  run: async (context, options) => {
    const periods = await readPeriods(context, options);
    const campaigns: CampaignComparison[] = [];
    const tooFewSends: ThinCampaign[] = [];

    for (const { campaign, current, previous } of periods.campaigns) {
      const sent = [volumeOf(current), volumeOf(previous)] as const;

      if (sent.some((volume) => (volume ?? -1) < options.min_sent)) {
        tooFewSends.push({
          ...labelOf(campaign),
          currentSent: sent[0],
          previousSent: sent[1],
        });
      } else {
        campaigns.push({
          ...labelOf(campaign),
          ...comparePeriods(current, previous, options.alpha),
        });
      }
    }

    const comparison: PeriodComparison = {
      campaigns: campaigns.toSorted(
        (left, right) =>
          descending(
            left.change.replyRate === null
              ? null
              : Math.abs(left.change.replyRate),
            right.change.replyRate === null
              ? null
              : Math.abs(right.change.replyRate)
          ) || left.name.localeCompare(right.name)
      ),
      current: periods.current,
      days: options.days,
      previous: periods.previous,
      tooFewSends,
      total: totalOf(periods.campaigns, options.alpha),
      workspace: await workspaceOf(context, periods, options.alpha),
    };

    return comparison;
  },
});
