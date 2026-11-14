// The ops insights. Each file in this folder defines one; this list is what
// the registry reads.

import { anomalies } from "./anomalies.ts";
import { campaignDiagnosis } from "./campaign-diagnosis.ts";
import { campaignRanking } from "./campaign-ranking.ts";
import { channelMix } from "./channel-mix.ts";
import { clientReport } from "./client-report.ts";
import { periodComparison } from "./period-comparison.ts";
import { pipelineForecast } from "./pipeline-forecast.ts";
import { tagRollup } from "./tag-rollup.ts";

export const OPS_INSIGHTS = [
  campaignDiagnosis,
  pipelineForecast,
  anomalies,
  periodComparison,
  campaignRanking,
  channelMix,
  tagRollup,
  clientReport,
] as const;

export type {
  Anomalies,
  Anomaly,
  AnomalyMetric,
  MetricCoverage,
} from "./anomalies.ts";

export type { CampaignDiagnosis } from "./campaign-diagnosis.ts";

export type {
  CampaignRanking,
  RankedCampaign,
  RankingGap,
  RankingMetric,
  UnrankedCampaign,
} from "./campaign-ranking.ts";

export type {
  ChannelComparison,
  ChannelGroup,
  ChannelMix,
  ProviderGroup,
} from "./channel-mix.ts";

export type {
  ActionItem,
  BounceProblem,
  ClientReport,
  LeadRunway,
} from "./client-report.ts";

export type { DiagnosisCode, DiagnosisFinding } from "./diagnosis-checks.ts";

export type {
  CampaignComparison,
  Comparison,
  PeriodComparison,
  PeriodNumbers,
  ThinCampaign,
} from "./period-comparison.ts";

export type { Estimate, PipelineForecast } from "./pipeline-forecast.ts";

export type {
  CampaignLabel,
  DayRange,
  Measured,
  OpenRange,
  Rates,
  Totals,
} from "./shared.ts";

export type { TagGroup, TagRollup } from "./tag-rollup.ts";
