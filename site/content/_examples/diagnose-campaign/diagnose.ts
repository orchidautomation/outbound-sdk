import type { Outbound } from "outbound-sdk";
import type { BenchmarksExtension } from "outbound-sdk/benchmarks";
import type { InsightsExtension } from "outbound-sdk/insights";

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${(rate * 100).toFixed(1)}%`;

const times = (ratio: number | null): string =>
  ratio === null ? "no comparison" : `${ratio.toFixed(2)} times the workspace`;

/** Why one campaign is underperforming, as plain text. */
export const diagnose = async (
  outbound: Outbound & InsightsExtension & BenchmarksExtension,
  campaign: string
): Promise<string> => {
  const { data, meta } = await outbound.insights.campaignDiagnosis({
    campaign,
  });

  const lines = [`${data.name} (${data.status}): ${data.summary}`, ""];

  for (const finding of data.findings) {
    lines.push(
      `[${finding.severity}] ${finding.code}: ${finding.finding}`,
      `    next: ${finding.next}`
    );
  }

  // An empty list of findings means nothing was found in what could be
  // checked. This is the other half of that sentence.
  if (data.notChecked.length > 0) {
    lines.push(
      "",
      "Not checked:",
      ...data.notChecked.map((what) => `  - ${what}`)
    );
  }

  // Context 1: the days that broke from the campaign's own trend.
  if (outbound.capabilities["stats.byDay"] !== false) {
    const unusual = await outbound.insights.anomalies({
      campaign: data.campaign,
      days: 14,
    });

    lines.push(
      "",
      "Unusual days in the last 14:",
      ...unusual.data.anomalies.map((anomaly) => `  - ${anomaly.finding}`),
      ...unusual.data.metrics.flatMap((metric) =>
        metric.reason === null
          ? []
          : [`  - ${metric.metric} could not be tested: ${metric.reason}`]
      )
    );
  }

  // Context 2: the campaign beside the whole workspace it runs in.
  const { comparisons } = await outbound.benchmarks.campaign(data.campaign);

  lines.push(
    "",
    "Against the whole workspace:",
    `  reply rate ${percent(comparisons.replyRate.value)} against ${percent(comparisons.replyRate.baseline)} (${times(comparisons.replyRate.ratio)})`,
    `  bounce rate ${percent(comparisons.bounceRate.value)} against ${percent(comparisons.bounceRate.baseline)} (${times(comparisons.bounceRate.ratio)})`
  );

  if (!meta.complete) {
    lines.push(
      "",
      "The diagnosis covers part of the data:",
      ...meta.notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
