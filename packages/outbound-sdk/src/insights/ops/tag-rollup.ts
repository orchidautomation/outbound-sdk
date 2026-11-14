// tag_rollup: results by campaign tag.

import { z } from "zod";

import { sumCounts } from "../../internal/metrics.ts";
import { defineInsight } from "../define.ts";
import {
  descending,
  listFields,
  rangeFields,
  ratesOf,
  readCampaignTotals,
  totalsOf,
  volumeOf,
} from "./shared.ts";
import type { CampaignTotals, OpenRange, Rates, Totals } from "./shared.ts";

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

export interface TagGroup extends Totals, Rates {
  /** The tag, or `null` for campaigns that carry none. */
  readonly tag: string | null;
  readonly campaigns: number;
}

export interface TagRollup {
  readonly period: OpenRange;
  /** Campaigns read. One with two tags counts in both of its tags. */
  readonly campaigns: number;
  /** Best first, by the low end of the reply rate interval. */
  readonly tags: readonly TagGroup[];
  readonly tooFewSends: readonly TagGroup[];
}

const groupOf = (
  tag: string | null,
  entries: readonly CampaignTotals[]
): TagGroup => {
  const totals = totalsOf(sumCounts(entries.map((entry) => entry.counts)));

  return { ...totals, ...ratesOf(totals), campaigns: entries.length, tag };
};

const named = (group: TagGroup): string => group.tag ?? "";

export const tagRollup = defineInsight({
  description:
    "Results by campaign tag (for example one tag per client, offer or audience): for each tag the campaigns, messages sent, leads contacted, replies, positive replies and bounces, with reply, positive reply and bounce rates and their 95% intervals, sorted by the low end of the reply rate interval. A campaign with two tags counts in both; campaigns with none are grouped under a null tag. Tags under min_sent sends are listed apart. A null count is one the vendor does not report. Costs one listing per status plus one stats request per campaign.",
  inputSchema: input,
  key: "tagRollup",
  name: "tag_rollup",
  needs: ["stats.campaign"],
  next: "Use campaign_ranking to see the campaigns inside the best and the worst tag.",
  run: async (context, options) => {
    const entries = await readCampaignTotals(context, options);
    const members = new Map<string | null, CampaignTotals[]>();

    for (const entry of entries) {
      const tags =
        entry.campaign.tags.length === 0 ? [null] : entry.campaign.tags;

      for (const tag of new Set(tags)) {
        members.set(tag, [...(members.get(tag) ?? []), entry]);
      }
    }

    const groups = [...members]
      .map(([tag, group]) => groupOf(tag, group))
      .toSorted(
        (left, right) =>
          descending(left.replyRate.low, right.replyRate.low) ||
          named(left).localeCompare(named(right))
      );

    const enough = (group: TagGroup): boolean =>
      (volumeOf(group) ?? 0) >= options.min_sent;

    const rollup: TagRollup = {
      campaigns: entries.length,
      period: { from: options.from, to: options.to },
      tags: groups.filter(enough),
      tooFewSends: groups.filter((group) => !enough(group)),
    };

    return rollup;
  },
});
