// outbound-sdk/insights: answers to the questions operators ask, computed
// from the normalized reads. Each is one typed method, one agent tool and one
// CLI command. No model is called and nothing is stored.

export {
  insightCost,
  insights,
  listInsights,
  runInsightByName,
} from "./plugin.ts";

export type {
  InsightCostEstimate,
  Insights,
  InsightsExtension,
} from "./plugin.ts";

export type { InsightCost, Price } from "./cost.ts";

export type { InsightInputs } from "./inputs.generated.ts";

export { INSIGHT_TOOL_CEILING, insightTools } from "./tools.ts";

export type { InsightToolsOptions } from "./tools.ts";

export { defineInsight, runInsight } from "./define.ts";

export type {
  Cap,
  InsightContext,
  InsightDefinition,
  InsightMeta,
  InsightResult,
  RunOptions,
} from "./define.ts";

export { INSIGHTS } from "./registry.ts";

export {
  compareRates,
  deviation,
  mean,
  median,
  percentile,
  rate,
  round,
  tally,
  total,
  wilson,
  zScore,
} from "./stats.ts";

export type { Interval, ProportionTest, Sample } from "./stats.ts";

// oxlint-disable-next-line oxc/no-barrel-file -- types only: nothing is loaded at run time, and the list of 108 answer types lives in types.ts.
export type * from "./types.ts";
