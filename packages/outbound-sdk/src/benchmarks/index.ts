// outbound-sdk/benchmarks: comparison context from the account's own data.
// A campaign's reply rate means more next to the workspace's. No outside
// benchmark is used: only numbers this credential can read.

import type { OperationOptions } from "../internal/engine/engine.ts";
import { OutboundError } from "../internal/errors.ts";
import { computeRates } from "../internal/metrics.ts";
import type { MetricName } from "../internal/metrics.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface BenchmarkOptions extends OperationOptions {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface Comparison {
  /** The campaign's rate, 0 to 1, or `null` when it cannot be computed. */
  readonly value: number | null;
  /** The workspace's rate over the same dates. */
  readonly baseline: number | null;
  /** `value / baseline`: 1.2 means 20% above the workspace. */
  readonly ratio: number | null;
}

export interface CampaignBenchmark {
  readonly campaign: string;
  readonly comparisons: Readonly<Record<MetricName, Comparison>>;
  /** Vendor requests it cost. */
  readonly requests: number;
}

export interface BenchmarksExtension {
  readonly benchmarks: {
    /** A campaign's rates beside the whole workspace's. Costs two stats requests. */
    readonly campaign: (
      id: string,
      options?: BenchmarkOptions
    ) => Promise<CampaignBenchmark>;
  };
}

const compare = (
  value: number | null,
  baseline: number | null
): Comparison => ({
  baseline,
  ratio:
    value === null || baseline === null || baseline === 0
      ? null
      : value / baseline,
  value,
});

const benchmarkCampaign = async (
  outbound: OutboundApi,
  id: string,
  options: BenchmarkOptions
): Promise<CampaignBenchmark> => {
  const [campaign, workspace] = await Promise.all([
    outbound.campaign(id).stats(options),
    outbound.stats(options),
  ]);

  const [own] = campaign.rows;

  // A combined instance returns one workspace row per member: use the campaign's own.
  const baseline = workspace.rows.find(
    (row) =>
      row.provider === own?.provider && row.workspaceId === own.workspaceId
  );

  if (own === undefined || baseline === undefined) {
    throw new OutboundError(
      "NotFound",
      `No stats were returned for campaign ${id}`,
      {
        provider: outbound.provider,
      }
    );
  }

  const rates = computeRates(own);
  const baselineRates = computeRates(baseline);

  return {
    campaign: own.scopeRef,
    comparisons: {
      acceptanceRate: compare(
        rates.acceptanceRate.value,
        baselineRates.acceptanceRate.value
      ),
      bounceRate: compare(
        rates.bounceRate.value,
        baselineRates.bounceRate.value
      ),
      openRate: compare(rates.openRate.value, baselineRates.openRate.value),
      positiveReplyRate: compare(
        rates.positiveReplyRate.value,
        baselineRates.positiveReplyRate.value
      ),
      replyRate: compare(rates.replyRate.value, baselineRates.replyRate.value),
      unsubscribeRate: compare(
        rates.unsubscribeRate.value,
        baselineRates.unsubscribeRate.value
      ),
    },
    requests: campaign.meta.requests + workspace.meta.requests,
  };
};

/** Compares a campaign with its own workspace. */
export const benchmarks = (): OutboundPlugin<BenchmarksExtension> => ({
  extend: (outbound) => ({
    benchmarks: {
      campaign: (id, options = {}) => benchmarkCampaign(outbound, id, options),
    },
  }),
  name: "benchmarks",
});
