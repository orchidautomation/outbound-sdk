// anomalies: days whose counts broke from the days before them.

import { z } from "zod";

import { defineInsight } from "../define.ts";
import { refOf } from "../ref.ts";
import { mean, round, spoken, zScore } from "../stats.ts";
import { descending, lastDays, readDaily, shiftDay } from "./shared.ts";
import type { DayCounts, DayRange } from "./shared.ts";

const metricSchema = z.enum([
  "sent",
  "contacted",
  "replied",
  "positive",
  "bounced",
  "opened",
  "clicked",
  "unsubscribed",
]);

export type AnomalyMetric = z.infer<typeof metricSchema>;

/**
 * A day and its baseline both under this count are not judged: one LinkedIn
 * reply against an average of 0.1 a day is a z-score of 3.5 and no news.
 */
export const MIN_COUNT = 3;

const input = z.object({
  baseline_days: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(14)
    .describe("How many days before a day form the baseline it is held to"),
  campaign: z
    .string()
    .min(3)
    .nullable()
    .default(null)
    .describe(
      "A campaign ref. null checks the whole workspace, which needs workspace stats."
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(30)
    .describe("How many complete days, ending yesterday, are checked"),
  metrics: z
    .array(metricSchema)
    .min(1)
    .default(["sent", "replied", "bounced"])
    .describe("The daily counts to check"),
  min_count: z
    .number()
    .int()
    .min(0)
    .default(MIN_COUNT)
    .describe(
      "A day is judged only when its count or baseline mean reaches this, so one reply on a quiet day is not flagged. 0 judges all."
    ),
  min_baseline_points: z
    .number()
    .int()
    .min(2)
    .default(5)
    .describe("The fewest baseline days with data a day needs to be tested"),
  threshold: z
    .number()
    .positive()
    .default(2.5)
    .describe("How many standard deviations from the baseline mean is unusual"),
});

export interface Anomaly {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly metric: AnomalyMetric;
  readonly value: number;
  readonly baselineMean: number;
  /** Days with data the baseline was built from. */
  readonly baselinePoints: number;
  /** `null` when the baseline was flat: with no spread there is no z-score. */
  readonly zScore: number | null;
  /**
   * How the day was judged. `z_score`: it is `threshold` standard deviations
   * or more from the baseline mean. `flat_baseline`: every baseline day had
   * the same count and this day has another.
   */
  readonly judgedBy: "flat_baseline" | "z_score";
  readonly direction: "above" | "below";
  readonly finding: string;
}

export interface MetricCoverage {
  readonly metric: AnomalyMetric;
  /** Checked days the vendor reports this count for. */
  readonly daysWithData: number;
  /** Of those, the days that had a usable baseline. */
  readonly daysTested: number;
  readonly testable: boolean;
  /** Why no day could be tested. `null` when at least one was. */
  readonly reason: string | null;
}

export interface AnomalyOptions {
  readonly metrics: readonly AnomalyMetric[];
  readonly threshold: number;
  readonly baselineDays: number;
  readonly minBaselinePoints: number;
  /** A day whose count and baseline mean are both under this is not judged. Defaults to `MIN_COUNT`. */
  readonly minCount?: number | undefined;
  /** The first day that is tested. Earlier days only feed baselines. */
  readonly firstDay: string;
}

export interface AnomalyScan {
  /** Newest first, then the largest break first. */
  readonly anomalies: readonly Anomaly[];
  readonly metrics: readonly MetricCoverage[];
}

export interface Anomalies extends AnomalyScan {
  /** The campaign's ref, or `workspace`. */
  readonly scope: string;
  /** The days checked. */
  readonly period: DayRange;
  readonly threshold: number;
}

interface Point {
  readonly date: string;
  readonly value: number;
}

interface MetricScan {
  readonly anomalies: Anomaly[];
  readonly coverage: MetricCoverage;
}

const reasonFor = (metric: AnomalyMetric, daysWithData: number): string =>
  daysWithData === 0
    ? `The vendor reports no ${metric} count for these days.`
    : "Too few earlier days with data to form a baseline.";

/** Judges one day against its baseline. `null` when the day is not unusual. */
const judge = (
  metric: AnomalyMetric,
  point: Point,
  baseline: readonly number[],
  threshold: number
): Anomaly | null => {
  const center = round(mean(baseline)) ?? 0;
  const score = zScore(point.value, baseline);

  const shared = {
    baselineMean: center,
    baselinePoints: baseline.length,
    date: point.date,
    direction: point.value > center ? ("above" as const) : ("below" as const),
    metric,
    value: point.value,
  };

  // A flat baseline has no standard deviation, so z is undefined. A day that
  // differs from it is still a break, and is said to be judged that way.
  if (score === null) {
    return point.value === baseline[0]
      ? null
      : {
          ...shared,
          finding: `${metric} was ${point.value} on ${point.date}, against ${spoken(center)} on each of the ${baseline.length} days with data before it (a flat baseline has no z-score: any other count is flagged).`,
          judgedBy: "flat_baseline",
          zScore: null,
        };
  }

  return Math.abs(score) < threshold
    ? null
    : {
        ...shared,
        finding: `${metric} was ${point.value} on ${point.date}, against an average of ${spoken(center)} over the ${baseline.length} days with data before it (z = ${spoken(score)}).`,
        judgedBy: "z_score",
        zScore: round(score) ?? 0,
      };
};

const scanMetric = (
  series: readonly DayCounts[],
  metric: AnomalyMetric,
  options: AnomalyOptions
): MetricScan => {
  const points: Point[] = series.flatMap((day) => {
    const value = day.counts[metric];

    return value === null ? [] : [{ date: day.date, value }];
  });

  const checked = points.filter((point) => point.date >= options.firstDay);
  const anomalies: Anomaly[] = [];
  let tested = 0;

  for (const point of checked) {
    const start = shiftDay(point.date, -options.baselineDays);

    // The days before the day, never the day itself.
    const baseline = points.flatMap((other) =>
      other.date >= start && other.date < point.date ? [other.value] : []
    );

    const minCount = options.minCount ?? MIN_COUNT;

    // Too few to tell a break from noise: tested, never flagged.
    const tooSmall = point.value < minCount && (mean(baseline) ?? 0) < minCount;

    if (baseline.length >= options.minBaselinePoints) {
      tested += 1;

      const anomaly = tooSmall
        ? null
        : judge(metric, point, baseline, options.threshold);

      if (anomaly !== null) {
        anomalies.push(anomaly);
      }
    }
  }

  return {
    anomalies,
    coverage: {
      daysTested: tested,
      daysWithData: checked.length,
      metric,
      reason: tested > 0 ? null : reasonFor(metric, checked.length),
      testable: tested > 0,
    },
  };
};

/** How far a day broke, for sorting. A break from a flat baseline has no z-score and sorts first. */
const sizeOf = (anomaly: Anomaly): number =>
  anomaly.zScore === null ? Number.POSITIVE_INFINITY : Math.abs(anomaly.zScore);

/** Holds each day's count to the days before it. `series` is oldest first and includes the baseline days. */
export const findAnomalies = (
  series: readonly DayCounts[],
  options: AnomalyOptions
): AnomalyScan => {
  const scans = [...new Set(options.metrics)].map((metric) =>
    scanMetric(series, metric, options)
  );

  return {
    anomalies: scans
      .flatMap((scan) => scan.anomalies)
      .toSorted(
        (left, right) =>
          right.date.localeCompare(left.date) ||
          descending(sizeOf(left), sizeOf(right))
      ),
    metrics: scans.map((scan) => scan.coverage),
  };
};

export const anomalies = defineInsight({
  description:
    "Days that broke from trend, for one campaign or the whole workspace: each of the last `days` complete days is held to the `baseline_days` before it, and a daily count `threshold` standard deviations or more from the baseline mean is returned, newest first, with its value, the baseline mean, the z-score, the direction and how it was judged. Use it to spot a sending outage, a bounce spike or a reply surge. Days the vendor has no count for are skipped, never read as zero. Costs one stats request.",
  inputSchema: input,
  key: "anomalies",
  cost: (_input, price) => price.one("stats"),
  name: "anomalies",
  needs: ["stats.byDay"],
  // The whole workspace is read from workspace stats, a campaign from its own.
  needsFor: (options) =>
    options.campaign === null ? ["stats.workspace"] : ["stats.campaign"],
  next: "Use campaign_diagnosis on the campaign, or bounce_watch when the break is in bounces.",
  run: async (context, options) => {
    const period = lastDays(context.now, options.days);

    const series = await readDaily(context, options.campaign, {
      from: shiftDay(period.from, -options.baseline_days),
      to: period.to,
    });

    const answer: Anomalies = {
      ...findAnomalies(series, {
        baselineDays: options.baseline_days,
        firstDay: period.from,
        metrics: options.metrics,
        minBaselinePoints: options.min_baseline_points,
        minCount: options.min_count,
        threshold: options.threshold,
      }),
      period,
      scope:
        options.campaign === null
          ? "workspace"
          : refOf(context.outbound, options.campaign),
      threshold: options.threshold,
    };

    return answer;
  },
});
