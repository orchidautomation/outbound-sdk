// When a campaign has many skipped leads: leads the tool loaded and then
// decided never to send to, for example ones a block list or a duplicate
// rule kept out. campaign_diagnosis and client_report share the rule.
//
// The defaults: 5% of the campaign's leads and at least 100 of them. On the
// live workspace of OUT-175 a broken block-list sync left 2,251 of 31,243
// leads (7%) skipped on its largest campaign, and 200 to 2,251 on each of
// five; a duplicate or two kept out of a campaign stays under both.

import { z } from "zod";

import type { Campaign } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { count as formatCount, plural } from "../../internal/numbers.ts";
import type { InsightContext } from "../define.ts";
import { percent } from "../stats.ts";
import { labelOf } from "./shared.ts";
import type { CampaignLabel } from "./shared.ts";

export const MAX_SKIPPED_SHARE = 0.05;
export const MIN_SKIPPED = 100;

/** The inputs both insights take, with the same defaults. */
export const skippedFields = {
  max_skipped_share: z
    .number()
    .min(0)
    .max(1)
    .default(MAX_SKIPPED_SHARE)
    .describe(
      "Skipped leads (loaded, then never sent to by the tool) over this share of a campaign's leads are a finding"
    ),
  min_skipped: z
    .number()
    .int()
    .min(1)
    .default(MIN_SKIPPED)
    .describe("Fewer skipped leads than this are never a finding"),
};

export interface SkippedLimits {
  readonly maxSkippedShare: number;
  readonly minSkipped: number;
}

/** The limits, from the inputs of `skippedFields`. */
export const skippedLimits = (input: {
  readonly max_skipped_share: number;
  readonly min_skipped: number;
}): SkippedLimits => ({
  maxSkippedShare: input.max_skipped_share,
  minSkipped: input.min_skipped,
});

/** A campaign's skipped leads against its leads, from its progress. */
export interface SkippedCount {
  /** Leads the tool decided never to send to. `null` when it does not say. */
  readonly skipped: number | null;
  /** Every lead in the campaign. */
  readonly leads: number | null;
}

/** The share of the leads skipped, when it is over both limits; otherwise `null`. */
export const manySkipped = (
  { leads, skipped }: SkippedCount,
  limits: SkippedLimits
): number | null => {
  if (skipped === null || leads === null || leads <= 0) {
    return null;
  }

  const share = skipped / leads;

  return skipped >= limits.minSkipped && share > limits.maxSkippedShare
    ? share
    : null;
};

export const SKIPPED_NEXT =
  "Check the workspace block list (and any sync that writes to it) and the campaign's rules for duplicates and leads in other campaigns; list the campaign's leads to see which were skipped.";

export const skippedFinding = (
  { leads, skipped }: { readonly leads: number; readonly skipped: number },
  share: number,
  limits: SkippedLimits
): string =>
  `${formatCount(skipped)} of ${plural(leads, "lead")} (${percent(share)}) ${skipped === 1 ? "was" : "were"} loaded and then skipped: the tool will never send to them. That is over the ${percent(limits.maxSkippedShare)} limit, and usually a block list or a duplicate rule keeping out leads that were meant to be sent to.`;

/** `true` when the instance can say how many of a campaign's leads were skipped. */
export const canCountSkipped = (context: InsightContext): boolean => {
  const { capabilities, fields } = context.outbound;

  return (
    capabilities["campaigns.progress"] &&
    fields.campaignProgress["skipped"] !== false
  );
};

export interface SkippedLeads extends CampaignLabel {
  /** Leads the tool decided never to send to. */
  readonly skipped: number;
  /** Every lead in the campaign. */
  readonly leads: number;
  /** `skipped` over `leads`. */
  readonly share: number;
}

/**
 * The campaigns among `campaigns` with many skipped leads, highest share
 * first, at one progress read each. `null` when the instance cannot count
 * skipped leads.
 */
export const readManySkipped = async (
  context: InsightContext,
  campaigns: readonly Campaign[],
  limits: SkippedLimits
): Promise<SkippedLeads[] | null> => {
  if (!canCountSkipped(context)) {
    return null;
  }

  const counted = await context.each(
    campaigns,
    async (campaign) => {
      try {
        return {
          campaign,
          progress: context.one(
            await context.outbound.campaign(campaign.ref).progress()
          ),
        };
      } catch (error) {
        // A campaign the progress report does not hold costs only its own check.
        if (OutboundError.is(error) && error.code === "NotFound") {
          return { campaign, progress: null };
        }

        throw error;
      }
    },
    "campaigns' progress"
  );

  // No progress, or progress without a skipped count (such as one stopped
  // at the adapter's cap): the campaign was not checked, so the answer is
  // partial, not a clean "none has many skipped leads".
  const unchecked = counted.flatMap(({ campaign, progress }) =>
    progress === null || (progress.skipped ?? null) === null
      ? [campaign.name]
      : []
  );

  if (unchecked.length > 0) {
    context.partial(
      `Skipped leads were not counted for ${plural(unchecked.length, "campaign")}, so manySkippedLeads leaves ${unchecked.length === 1 ? "it" : "them"} out: ${unchecked.slice(0, 10).join(", ")}${unchecked.length > 10 ? ` and ${unchecked.length - 10} more` : ""}.`
    );
  }

  return counted
    .flatMap(({ campaign, progress }) => {
      if (progress === null) {
        return [];
      }

      const { leads } = progress;
      const skipped = progress.skipped ?? null;
      const share = manySkipped({ leads, skipped }, limits);

      return share === null || leads === null || skipped === null
        ? []
        : [{ ...labelOf(campaign), leads, share, skipped }];
    })
    .toSorted((left, right) => right.share - left.share);
};
