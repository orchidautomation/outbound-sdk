// tag_rollup: results by campaign tag.

import { z } from "zod";

import { sumMeasured } from "../../internal/metrics.ts";
import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import { rangeFields } from "../fields.ts";
import {
  campaignTotalsCost,
  descending,
  listFields,
  partialNote,
  ratesAcross,
  readCampaignTotals,
  replyBasisAcross,
  totalsOf,
  volumeOf,
} from "./shared.ts";
import type {
  CampaignTotals,
  OpenRange,
  Rates,
  ReplyBasis,
  Totals,
} from "./shared.ts";

const input = z.object({
  ...rangeFields,
  ...listFields("one stats request"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(50)
    .describe("Tags with fewer sends than this are listed apart, unsorted"),
});

/**
 * A tag's counts are every campaign's added up. Each rate counts only the
 * campaigns that report both sides of it, so its `count` and `of` can be
 * smaller than the totals beside it; a note says when.
 */
export interface TagGroup extends Totals, Rates {
  /** The tag, or `null` for campaigns that carry none. */
  readonly tag: string | null;
  readonly campaigns: number;
}

export interface TagRollup extends CampaignsRead {
  readonly period: OpenRange;
  /** Campaigns read. One with two tags counts in both of its tags. */
  readonly campaigns: number;
  /** Best first, by the low end of the reply rate interval. */
  readonly tags: readonly TagGroup[];
  readonly tooFewSends: readonly TagGroup[];
  /**
   * What every reply and positive reply rate divides by: leads contacted, or
   * messages sent when a campaign has replies in the range but contacted no
   * new lead in it.
   * Always set by the insight; optional so a value built by hand stays valid.
   */
  readonly replyRateBasis?: ReplyBasis;
}

interface Grouped {
  readonly group: TagGroup;
  /** The rates that leave campaigns out. */
  readonly partial: readonly string[];
}

const groupOf = (
  tag: string | null,
  entries: readonly CampaignTotals[],
  basis: ReplyBasis
): Grouped => {
  const counts = entries.map((entry) => entry.counts);
  const { partial, rates } = ratesAcross(counts, basis);

  return {
    group: {
      ...totalsOf(sumMeasured(counts)),
      ...rates,
      campaigns: entries.length,
      tag,
    },
    partial,
  };
};

const named = (group: TagGroup): string => group.tag ?? "";

export const tagRollup = defineInsight({
  description:
    "Results by campaign tag (for example one tag per client, offer or audience): for each tag the campaigns, messages sent, leads contacted, replies, positive replies and bounces, with reply, positive reply and bounce rates and their 95% intervals, sorted by the low end of the reply rate interval. A campaign with two tags counts in both; campaigns with none are grouped under a null tag. Tags under min_sent sends are listed apart. replyRateBasis names what every reply rate divides by, the same for every campaign: leads contacted, or messages sent when a campaign has replies in the range but contacted no new lead in it. A null count is one the vendor does not report; a rate counts only the campaigns that report both its count and what it divides by, and a note names a tag whose rate leaves campaigns out. Costs one listing per status plus one stats request per campaign (one for all of them on a vendor that reports every campaign in one call with every count).",
  inputSchema: input,
  key: "tagRollup",
  // A tool whose campaigns carry no tags would put every campaign under one
  // null tag, which reads as an answer. On a combined instance one tool with
  // tags is enough.
  lacks: (outbound) =>
    outbound.fields.campaign["tags"] === false ? "campaign tags" : null,
  cost: campaignTotalsCost,
  scales: "max_campaigns",
  name: "tag_rollup",
  needs: ["stats.campaign"],
  next: "Use campaign_ranking to see the campaigns inside the best and the worst tag.",
  run: async (context, options) => {
    const { entries, read } = await readCampaignTotals(context, options);
    const members = new Map<string | null, CampaignTotals[]>();

    for (const entry of entries) {
      const tags =
        entry.campaign.tags.length === 0 ? [null] : entry.campaign.tags;

      for (const tag of new Set(tags)) {
        members.set(tag, [...(members.get(tag) ?? []), entry]);
      }
    }

    const basis = replyBasisAcross(entries.map((entry) => entry.counts));

    const grouped = [...members].map(([tag, group]) =>
      groupOf(tag, group, basis)
    );

    for (const { group, partial } of grouped) {
      if (partial.length > 0) {
        context.note(
          partialNote(
            group.tag === null ? "Untagged campaigns" : `Tag ${group.tag}`,
            partial
          )
        );
      }
    }

    const groups = grouped
      .map((each) => each.group)
      .toSorted(
        (left, right) =>
          descending(left.replyRate.low, right.replyRate.low) ||
          named(left).localeCompare(named(right))
      );

    const enough = (group: TagGroup): boolean =>
      (volumeOf(group) ?? 0) >= options.min_sent;

    const rollup: TagRollup = {
      ...read,
      campaigns: entries.length,
      period: { from: options.from, to: options.to },
      replyRateBasis: basis,
      tags: groups.filter(enough),
      tooFewSends: groups.filter((group) => !enough(group)),
    };

    return rollup;
  },
});
