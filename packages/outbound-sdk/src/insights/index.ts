// outbound-sdk/insights: answers to the questions operators ask, computed
// from the normalized reads. Each is one typed method, one agent tool and one
// CLI command. No model is called and nothing is stored.

export { insights, listInsights, runInsightByName } from "./plugin.ts";

export type { Insights, InsightsExtension } from "./plugin.ts";

export { insightTools } from "./tools.ts";

export type { InsightToolsOptions } from "./tools.ts";

export { defineInsight, runInsight } from "./define.ts";

export type {
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

export type { PersonCampaign, PersonSummary } from "./people/person-summary.ts";
