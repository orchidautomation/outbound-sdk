// anomalies: days whose counts broke from the days before them.

import { z } from "zod";

import { defineInsight } from "../define.ts";
import { mean, round, zScore } from "../stats.ts";
import { lastDays, readDaily, shiftDay } from "./shared.ts";
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
    .describe("A campaign ref. null checks the whole workspace."),
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
  readonly zScore: number;
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

const reasonFor = (
  metric: AnomalyMetric,
  daysWithData: number,
  flat: number
): string => {
  if (daysWithData === 0) {
    return `The vendor reports no ${metric} count for these days.`;
  }

  return flat > 0
    ? "The baseline has no spread: its days all have the same count, so nothing can be called unusual."
    : "Too few earlier days with data to form a baseline.";
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
  let flat = 0;

  for (const point of checked) {
    const start = shiftDay(point.date, -options.baselineDays);

    const baseline = points.flatMap((other) =>
      other.date >= start && other.date < point.date ? [other.value] : []
    );

    const score =
      baseline.length < options.minBaselinePoints
        ? null
        : zScore(point.value, baseline);

    flat += Number(
      baseline.length >= options.minBaselinePoints && score === null
    );

    if (score !== null) {
      tested += 1;

      if (Math.abs(score) >= options.threshold) {
        const center = round(mean(baseline)) ?? 0;

        anomalies.push({
          baselineMean: center,
          baselinePoints: baseline.length,
          date: point.date,
          direction: score > 0 ? "above" : "below",
          finding: `${metric} was ${point.value} on ${point.date}, against an average of ${center} over the ${baseline.length} days with data before it (z = ${round(score)}).`,
          metric,
          value: point.value,
          zScore: round(score) ?? 0,
        });
      }
    }
  }

  return {
    anomalies,
    coverage: {
      daysTested: tested,
      daysWithData: checked.length,
      metric,
      reason: tested > 0 ? null : reasonFor(metric, checked.length, flat),
      testable: tested > 0,
    },
  };
};

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
          Math.abs(right.zScore) - Math.abs(left.zScore)
      ),
    metrics: scans.map((scan) => scan.coverage),
  };
};

export const anomalies = defineInsight({
  description:
    "Days that broke from trend, for one campaign or the whole workspace: each of the last `days` complete days is held to the `baseline_days` before it, and a daily count more than `threshold` standard deviations from that baseline's mean is returned, newest first, with the metric, the value, the baseline mean, the z-score and the direction. Use it to spot a sending outage, a bounce spike or a reply surge. Days the vendor has no count for are skipped, never read as zero, and a metric whose baseline has no spread is reported as not testable. Costs one stats request.",
  inputSchema: input,
  key: "anomalies",
  name: "anomalies",
  needs: ["stats.byDay"],
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
        threshold: options.threshold,
      }),
      period,
      scope: options.campaign ?? "workspace",
      threshold: options.threshold,
    };

    return answer;
  },
});
