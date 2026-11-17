// channel_mix: email against LinkedIn, from campaign totals.

import { z } from "zod";

import type { CampaignStatus, Channel } from "../../internal/entities.ts";
import { sumMeasured } from "../../internal/metrics.ts";
import { either } from "../capped.ts";
import type { CampaignsRead } from "../capped.ts";
import { defineInsight } from "../define.ts";
import { rangeFields } from "../fields.ts";
import { compareRates, percent, pText, round } from "../stats.ts";
import type { ProportionTest } from "../stats.ts";
import {
  baseIn,
  campaignTotalsCost,
  listFields,
  measureAcross,
  partialNote,
  partialRate,
  readCampaignTotals,
  replyBasisAcross,
  totalsOf,
} from "./shared.ts";
import type {
  CampaignTotals,
  Measured,
  OpenRange,
  ReplyBasis,
  Totals,
} from "./shared.ts";

const input = z.object({
  ...rangeFields,
  ...listFields("one stats request", {
    maxCampaigns: 150,
    statuses: ["active", "paused", "completed"],
  }),
  alpha: z
    .number()
    .gt(0)
    .lt(1)
    .default(0.05)
    .describe(
      "The p-value under which a difference counts as more than chance"
    ),
});

export interface ChannelGroup extends Totals {
  readonly channel: Channel;
  readonly campaigns: number;
  readonly replyRate: Measured;
  readonly positiveRate: Measured;
  /** Connection requests accepted out of those sent. `null` for email. */
  readonly acceptance: Measured | null;
}

export interface ProviderGroup extends ChannelGroup {
  readonly provider: string;
}

export interface ChannelComparison {
  /** The channel with the higher reply rate. */
  readonly higher: Channel;
  /** The higher reply rate minus the lower one. */
  readonly difference: number;
  readonly test: ProportionTest;
}

export interface ChannelMix extends CampaignsRead {
  readonly period: OpenRange;
  /** Email first, then LinkedIn; only the channels that have campaigns. */
  readonly channels: readonly ChannelGroup[];
  /** `null` when there is one channel, or a channel has no counts to compare. */
  readonly comparison: ChannelComparison | null;
  readonly finding: string;
  /** The same numbers for each tool and channel. */
  readonly byProvider: readonly ProviderGroup[];
  /**
   * What every reply and positive reply rate divides by: leads contacted, or
   * messages sent when a campaign has replies in the range but contacted no
   * new lead in it.
   * Always set by the insight; optional so a value built by hand stays valid.
   */
  readonly replyRateBasis?: ReplyBasis;
}

interface Grouped {
  readonly group: ChannelGroup;
  /** The rates that leave campaigns out. */
  readonly partial: readonly string[];
}

const groupOf = (
  channel: Channel,
  entries: readonly CampaignTotals[],
  basis: ReplyBasis
): Grouped => {
  const counts = entries.map((entry) => entry.counts);
  const base = baseIn(basis);
  const reply = measureAcross(counts, (row) => row.replied, base);
  const positive = measureAcross(counts, (row) => row.positive, base);

  const acceptance = measureAcross(
    counts,
    (row) => row.connectionsAccepted,
    (row) => row.connectionsSent
  );

  return {
    group: {
      ...totalsOf(sumMeasured(counts)),
      acceptance: channel === "linkedin" ? acceptance.measured : null,
      campaigns: entries.length,
      channel,
      positiveRate: positive.measured,
      replyRate: reply.measured,
    },
    partial: [
      ...partialRate("reply rate", reply),
      ...partialRate("positive reply rate", positive),
      ...(channel === "linkedin"
        ? partialRate("acceptance rate", acceptance)
        : []),
    ],
  };
};

const CHANNELS = ["email", "linkedin"] as const;

const byChannel = (
  entries: readonly CampaignTotals[],
  basis: ReplyBasis
): Grouped[] =>
  CHANNELS.flatMap((channel) => {
    const members = entries.filter(
      (entry) => entry.campaign.channel === channel
    );

    return members.length === 0 ? [] : [groupOf(channel, members, basis)];
  });

interface ProviderGrouped {
  readonly group: ProviderGroup;
  readonly partial: readonly string[];
}

const byProvider = (
  entries: readonly CampaignTotals[],
  basis: ReplyBasis
): ProviderGrouped[] =>
  [...new Set(entries.map((entry) => entry.campaign.provider))]
    .toSorted()
    .flatMap((provider) =>
      byChannel(
        entries.filter((entry) => entry.campaign.provider === provider),
        basis
      ).map(({ group, partial }) => ({
        group: { ...group, provider },
        partial,
      }))
    );

const NAMES = { email: "email", linkedin: "LinkedIn" } as const;

const compare = (
  groups: readonly ChannelGroup[],
  alpha: number,
  read: CampaignsRead,
  statuses: readonly CampaignStatus[]
): Pick<ChannelMix, "comparison" | "finding"> => {
  const [first, second] = groups;

  if (first === undefined) {
    return {
      comparison: null,
      finding: "No campaigns were found, so there is nothing to compare.",
    };
  }

  if (second === undefined) {
    // Campaigns left unread may be on the other channel, so none is claimed absent.
    return {
      comparison: null,
      finding: read.moreCampaignsExist
        ? `Only ${NAMES[first.channel]} campaigns were read before max_campaigns stopped the read; campaigns left unread may be on the other channel, so raise max_campaigns to compare.`
        : `Only ${NAMES[first.channel]} campaigns are ${either([...new Set(statuses)])}, so there is nothing to compare; pass statuses to include campaigns in other states.`,
    };
  }

  const test = compareRates(
    { successes: first.replyRate.count, trials: first.replyRate.of },
    { successes: second.replyRate.count, trials: second.replyRate.of },
    alpha
  );

  if (test === null) {
    return {
      comparison: null,
      finding:
        "Reply rates cannot be compared: a channel has no reply or volume counts, or neither has a reply.",
    };
  }

  const [higher, lower] = test.z >= 0 ? [first, second] : [second, first];

  return {
    comparison: {
      difference:
        round((higher.replyRate.rate ?? 0) - (lower.replyRate.rate ?? 0)) ?? 0,
      higher: higher.channel,
      test,
    },
    finding: `The reply rate is ${percent(higher.replyRate.rate)} on ${NAMES[higher.channel]} against ${percent(lower.replyRate.rate)} on ${NAMES[lower.channel]}; ${
      test.significant
        ? "the difference is more than chance"
        : "the difference could be chance"
    } (${pText(test.pValue)}).`,
  };
};

export const channelMix = defineInsight({
  description:
    "Email against LinkedIn: campaign totals added up per channel, with campaigns, leads contacted, messages sent, replies, positive replies, the reply rate with its 95% interval and, for LinkedIn, the connection acceptance rate; whether the difference in reply rate is more than chance (a two-proportion test); and the same numbers per tool. Use it to decide where to put volume. It reads active, paused and completed campaigns by default, since a channel's finished campaigns hold most of its evidence. With one channel present it returns that channel and says there is nothing to compare; on several tools, a note names a tool with no campaign in the states read. replyRateBasis names what every reply rate divides by, the same for every campaign: leads contacted, or messages sent when a campaign has replies in the range but contacted no new lead in it. A null count is one the vendor does not report; a rate counts only the campaigns that report both its count and what it divides by, and a note names a group whose rate leaves campaigns out. Costs one listing per status plus one stats request per campaign (one for all of them on a vendor that reports every campaign in one call with every count).",
  inputSchema: input,
  key: "channelMix",
  cost: campaignTotalsCost,
  scales: "max_campaigns",
  name: "channel_mix",
  needs: ["stats.campaign"],
  next: "Use campaign_ranking to see which campaigns carry the better channel.",
  run: async (context, options) => {
    const { entries, read } = await readCampaignTotals(context, options);
    const basis = replyBasisAcross(entries.map((entry) => entry.counts));
    const channels = byChannel(entries, basis);
    const providers = byProvider(entries, basis);

    for (const { group, partial } of channels) {
      if (partial.length > 0) {
        context.note(partialNote(`Channel ${group.channel}`, partial));
      }
    }

    for (const { group, partial } of providers) {
      if (partial.length > 0) {
        context.note(
          partialNote(`${group.provider} ${group.channel}`, partial)
        );
      }
    }

    const mix: ChannelMix = {
      ...read,
      ...compare(
        channels.map((each) => each.group),
        options.alpha,
        read,
        options.statuses
      ),
      byProvider: providers.map((each) => each.group),
      channels: channels.map((each) => each.group),
      period: { from: options.from, to: options.to },
      replyRateBasis: basis,
    };

    return mix;
  },
});
