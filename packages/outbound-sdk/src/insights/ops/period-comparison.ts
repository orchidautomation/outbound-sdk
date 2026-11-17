// period_comparison: the last N days against the N days before.

import { z } from "zod";

import type { Campaign } from "../../internal/entities.ts";
import { sumMeasured } from "../../internal/metrics.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import { campaignsReadOf, readCampaignsIn } from "../capped.ts";
import type { CampaignsRead, Capped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { compareRates, percent, pText, round } from "../stats.ts";
import type { ProportionTest } from "../stats.ts";
import {
  descending,
  labelOf,
  lastDays,
  listFields,
  baseIn,
  partialNote,
  periodBasis,
  RATE_WORDS,
  ratesAcross,
  ratesOf,
  readTotals,
  totalsOf,
  volumeOf,
} from "./shared.ts";
import type {
  CampaignLabel,
  DayRange,
  Rates,
  ReplyBasis,
  Totals,
} from "./shared.ts";

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

/**
 * Counts and rates for one period, or the change between two. `null` is
 * unknown. The reply and positive reply rates are over `replyRateBasis`,
 * and `Comparison.rates` has the count and the denominator behind each.
 */
export interface PeriodNumbers extends Totals {
  readonly replyRate: number | null;
  readonly positiveRate: number | null;
  readonly bounceRate: number | null;
}

export interface Comparison {
  readonly current: PeriodNumbers;
  readonly previous: PeriodNumbers;
  /**
   * What replies and positive replies are divided by, the same in both
   * periods: messages sent when both report them, since a period's replies
   * also answer leads contacted before it, and otherwise leads contacted.
   */
  readonly replyRateBasis: ReplyBasis;
  /** `current` minus `previous`, field by field. Rates change in points: 0.02 is two points. */
  readonly change: PeriodNumbers;
  /**
   * Each period's rates with the counts behind them. Over several campaigns
   * a rate counts only those that report both sides, so its `count` and
   * `of` can be less than the totals in `current` and `previous`.
   * Always set by the insight; optional so a value built by hand stays valid.
   */
  readonly rates?: { readonly current: Rates; readonly previous: Rates };
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

export interface PeriodComparison extends CampaignsRead {
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

const numbersOf = (counts: Totals, rates: Rates): PeriodNumbers => ({
  ...totalsOf(counts),
  bounceRate: rates.bounceRate.rate,
  positiveRate: rates.positiveRate.rate,
  replyRate: rates.replyRate.rate,
});

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

const compare = (
  current: { readonly counts: Totals; readonly rates: Rates },
  previous: { readonly counts: Totals; readonly rates: Rates },
  basis: ReplyBasis,
  alpha: number
): Comparison => {
  const now = current.rates.replyRate;
  const before = previous.rates.replyRate;

  const test = compareRates(
    { successes: now.count, trials: now.of },
    { successes: before.count, trials: before.of },
    alpha
  );

  const rateName = RATE_WORDS[basis];
  const moved = `${rateName} went from ${percent(before.rate)} to ${percent(now.rate)}`;
  const numbers = numbersOf(current.counts, current.rates);
  const earlier = numbersOf(previous.counts, previous.rates);

  return {
    change: changeOf(numbers, earlier),
    current: numbers,
    finding:
      test === null
        ? `${rateName} cannot be compared: a period has no reply count or nothing to divide it by, or neither has a reply.`
        : `${moved}; ${
            test.significant
              ? "more than chance"
              : "within what chance would give"
          } (${pText(test.pValue)}).`,
    previous: earlier,
    rates: { current: current.rates, previous: previous.rates },
    replyRateBasis: basis,
    replyRateTest: test,
    verdict: verdictOf(test),
  };
};

/** Compares two periods of counts: both sides, the change, and whether the reply rate really moved. */
export const comparePeriods = (
  current: Totals,
  previous: Totals,
  alpha: number
): Comparison => {
  const basis = periodBasis(current, previous);

  return compare(
    { counts: current, rates: ratesOf(current, baseIn(basis)) },
    { counts: previous, rates: ratesOf(previous, baseIn(basis)) },
    basis,
    alpha
  );
};

export interface ComparedAcross {
  readonly comparison: Comparison;
  /** The rates that leave rows out, by period. Empty when every row is in every rate. */
  readonly partial: readonly string[];
}

/**
 * Compares two periods that are each several rows added up (campaigns, or
 * the tools of a combined instance). Counts are every row's; each rate is
 * over the rows that report both sides of it.
 */
export const compareAcross = (
  current: readonly MetricCounts[],
  previous: readonly MetricCounts[],
  alpha: number
): ComparedAcross => {
  const counts = [sumMeasured(current), sumMeasured(previous)] as const;
  const basis = periodBasis(...counts);
  const now = ratesAcross(current, basis);
  const before = ratesAcross(previous, basis);

  return {
    comparison: compare(
      { counts: counts[0], rates: now.rates },
      { counts: counts[1], rates: before.rates },
      basis,
      alpha
    ),
    partial: [
      ...now.partial.map((each) => `this period's ${each}`),
      ...before.partial.map((each) => `the earlier period's ${each}`),
    ],
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
  readonly read: CampaignsRead;
}

/**
 * The campaigns listed, each with its totals for the last `days` and the
 * `days` before: two stats requests per campaign.
 */
export const readPeriods = async (
  context: InsightContext,
  listed: Capped<Campaign>,
  days: number
): Promise<Periods> => {
  const current = lastDays(context.now, days);
  const previous = lastDays(context.now, days, 1);

  const campaigns = await context.each(
    listed.items,
    async (campaign): Promise<CampaignPeriods> => {
      const [now, before] = await Promise.all([
        readTotals(context, campaign.ref, current),
        readTotals(context, campaign.ref, previous),
      ]);

      return { campaign, current: now, previous: before };
    },
    "campaigns"
  );

  return { campaigns, current, previous, read: campaignsReadOf(listed) };
};

/** Every campaign's two periods added together. */
export const totalOf = (
  campaigns: readonly CampaignPeriods[],
  alpha: number
): ComparedAcross =>
  compareAcross(
    campaigns.map((entry) => entry.current),
    campaigns.map((entry) => entry.previous),
    alpha
  );

/** Says in a note which rates of a total leave rows out. Returns the comparison. */
export const noted = (
  context: InsightContext,
  where: string,
  across: ComparedAcross,
  rows?: string
): Comparison => {
  if (across.partial.length > 0) {
    context.note(partialNote(where, across.partial, rows));
  }

  return across.comparison;
};

interface WorkspaceRows {
  readonly current: readonly MetricCounts[];
  readonly previous: readonly MetricCounts[];
}

const readWorkspace = async (
  context: InsightContext,
  days: number
): Promise<WorkspaceRows | null> => {
  const { outbound } = context;

  if (outbound.capabilities["stats.workspace"] === false) {
    return null;
  }

  return {
    current: context.rows(await outbound.stats(lastDays(context.now, days))),
    previous: context.rows(
      await outbound.stats(lastDays(context.now, days, 1))
    ),
  };
};

const workspaceOf = (
  context: InsightContext,
  rows: WorkspaceRows | null,
  alpha: number
): Comparison | null => {
  if (rows === null) {
    context.note(
      "Workspace totals were left out: the adapter has no workspace stats. `total` adds up the campaigns read."
    );

    return null;
  }

  // A combined instance returns one row per tool, and the tools need not report the same counts.
  return noted(
    context,
    "Workspace totals",
    compareAcross(rows.current, rows.previous, alpha),
    "tools"
  );
};

export const periodComparison = defineInsight({
  description:
    "This period against the last: for each campaign, counts and rates for the last `days` complete days and for the `days` before, the change in each, and whether the change in the reply rate is more than chance (a two-proportion test), with the campaigns sorted by the size of that change. Also the same for every campaign added together and, where the adapter has them, for the vendor's workspace totals. Reply and positive reply rates divide by messages sent (`replyRateBasis`), since a period's replies also answer leads contacted before it, and by leads contacted for both periods only when a period does not report messages sent. Use it for a weekly review. Campaigns under min_sent sends in either period are listed apart; a null is a count the vendor does not report, and a rate of a total counts only the campaigns that report both its count and what it divides by (a note says when some are left out). Costs two stats requests per campaign plus two for the workspace.",
  inputSchema: input,
  key: "periodComparison",
  cost: (values, price) =>
    price.campaignsIn(new Set(values.statuses).size, values.max_campaigns) +
    2 * price.campaigns(values.max_campaigns) * price.one("stats") +
    (price.capabilities["stats.workspace"] === false
      ? 0
      : 2 * price.one("stats")),
  scales: "max_campaigns",
  name: "period_comparison",
  needs: ["stats.campaign"],
  partialOnCap: true,
  next: "Use campaign_diagnosis on the campaign whose reply rate fell the most.",
  run: async (context, options) => {
    const listed = await readCampaignsIn(
      context,
      options.statuses,
      options.max_campaigns
    );

    // Read before the campaigns, so a request cap that stops them part way leaves the workspace's totals in the answer.
    const workspace = await readWorkspace(context, options.days);
    const periods = await readPeriods(context, listed, options.days);
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
      ...periods.read,
      campaigns: campaigns.toSorted(
        (left, right) =>
          descending(
            left.change.replyRate === null
              ? null
              : Math.abs(left.change.replyRate),
            right.change.replyRate === null
              ? null
              : Math.abs(right.change.replyRate)
          ) || left.campaignName.localeCompare(right.campaignName)
      ),
      current: periods.current,
      days: options.days,
      previous: periods.previous,
      tooFewSends,
      total: noted(
        context,
        "Every campaign added together",
        totalOf(periods.campaigns, options.alpha)
      ),
      workspace: workspaceOf(context, workspace, options.alpha),
    };

    return comparison;
  },
});
