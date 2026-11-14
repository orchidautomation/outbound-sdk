import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${(rate * 100).toFixed(1)}%`;

/** Where one campaign's A/B tests stand today, as plain text. */
export const abVerdict = async (
  outbound: Outbound & InsightsExtension,
  campaign: string
): Promise<string> => {
  const test = await outbound.insights.variantTest({ campaign });
  const funnel = await outbound.insights.stepFunnel({ campaign });

  const lines = [
    `A/B tests of ${campaign}, judged on ${test.data.metric} at alpha ${test.data.alpha}`,
  ];

  for (const step of test.data.steps) {
    lines.push("", `Step ${step.step}: ${step.verdict}`, `  ${step.reason}`);

    for (const variant of step.variants) {
      lines.push(
        `  ${variant.variantKey}: ${percent(variant.rate)} (${variant.count} of ${variant.trials} ${variant.basis})${variant.enoughData ? "" : ", too few to compare"}`
      );
    }

    if (step.pValue !== null) {
      lines.push(`  p = ${step.pValue}`);
    }

    // A rough figure, not a date the test ends on. Under the minimum base it
    // is the sends still missing; otherwise it assumes both rates stay put.
    if (step.moreSendsNeeded !== null) {
      lines.push(
        step.verdict === "too_little_data"
          ? `  ${step.moreSendsNeeded} more sends before the variants are compared`
          : `  at these rates, about ${step.moreSendsNeeded} more sends before the gap would count`
      );
    }
  }

  // Which step the replies come from says how much a winner is worth.
  lines.push("", funnel.data.finding);

  for (const step of funnel.data.steps) {
    lines.push(
      `  step ${step.step}: ${percent(step.shareOfReplies)} of all replies`
    );
  }

  const notes = [...test.meta.notes, ...funnel.meta.notes];

  if (notes.length > 0) {
    lines.push(
      "",
      "Read this before relying on the numbers:",
      ...notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
