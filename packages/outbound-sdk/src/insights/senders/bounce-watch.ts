// bounce_watch: where bounces are too high.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Campaign, MetricRow } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rate, total, wilson } from "../stats.ts";
import type { Interval } from "../stats.ts";
import { dayInput, readCampaignSenders, readCapped } from "./read.ts";

const input = z.object({
  from: dayInput("First day to count"),
  include_senders: z
    .boolean()
    .default(true)
    .describe(
      "Also check the senders of each campaign over the threshold. Costs 1 listing per such campaign and 1 request per sender."
    ),
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("The most campaigns to check. Each costs 1 request."),
  max_senders_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(10)
    .describe("The most senders to check for one campaign over the threshold"),
  min_sent: z
    .number()
    .int()
    .min(0)
    .default(100)
    .describe("A campaign with fewer sends than this is too small to judge"),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.03)
    .describe("The bounce rate, bounced divided by sent, that is too high"),
  to: dayInput("Last day to count"),
});

export interface BounceCounts {
  readonly bounced: number;
  readonly sent: number;
  /** Bounced divided by sent. `null` when nothing was sent. */
  readonly rate: number | null;
  /** The Wilson interval of the rate; wide on few sends. */
  readonly interval: Interval | null;
}

export interface BounceSender extends BounceCounts {
  readonly sender: string;
  readonly address: string | null;
  readonly name: string | null;
}

export interface BounceCampaign extends BounceCounts {
  readonly campaign: string;
  readonly name: string;
  readonly status: string;
  readonly finding: string;
  /**
   * The campaign's senders over the threshold, worst first, counted over
   * everything each sender sent in the period, not this campaign alone.
   * `null` when the senders were not checked.
   */
  readonly senders: readonly BounceSender[] | null;
}

export interface BounceUnknown {
  readonly campaign: string;
  readonly name: string;
  readonly status: string;
  readonly reason: string;
}

export interface BounceWatch {
  /** Campaigns over the threshold, worst first. */
  readonly over: readonly BounceCampaign[];
  /** Campaigns with fewer sends than `min_sent`, whatever their rate. */
  readonly tooFewSends: readonly BounceCampaign[];
  /** Campaigns the vendor reports no sent or bounce count for. They are not clean. */
  readonly unknown: readonly BounceUnknown[];
  readonly totals: {
    readonly campaigns: number;
    readonly over: number;
    readonly clean: number;
    readonly tooFewSends: number;
    readonly unknown: number;
    /** Over the campaigns with a known sent and bounce count. */
    readonly bounced: number | null;
    readonly sent: number | null;
    readonly rate: number | null;
  };
  readonly threshold: number;
  readonly minSent: number;
}

interface Range {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

const countsOf = (bounced: number, sent: number): BounceCounts => ({
  bounced,
  interval: wilson(bounced, sent),
  rate: rate(bounced, sent),
  sent,
});

const known = (row: MetricRow | undefined): BounceCounts | null =>
  row === undefined || row.sent === null || row.bounced === null
    ? null
    : countsOf(row.bounced, row.sent);

const isOver = (counts: BounceCounts, threshold: number): boolean =>
  counts.rate !== null && counts.rate > threshold;

const whyUnknown = (row: MetricRow | undefined): string => {
  if (row === undefined) {
    return "The vendor returned no stats for the period.";
  }

  return row.sent === null
    ? "The vendor does not report a sent count."
    : "The vendor does not report a bounce count.";
};

/**
 * Reads each sender's stats once, however many campaigns share it. The read
 * is shared while in flight, so campaigns checked side by side ask once.
 */
const senderReader = (context: InsightContext, range: Range) => {
  const seen = new Map<string, Promise<BounceCounts | null>>();

  return (ref: string): Promise<BounceCounts | null> => {
    let counts = seen.get(ref);

    if (counts === undefined) {
      counts = context.outbound
        .sender(ref)
        .stats(range)
        .then((stats) => known(context.rows(stats)[0]));
      seen.set(ref, counts);
    }

    return counts;
  };
};

type SenderReader = ReturnType<typeof senderReader>;

const sendersOver = async (
  context: InsightContext,
  campaign: Campaign,
  options: {
    readonly max: number;
    readonly threshold: number;
    readonly read: SenderReader;
  }
): Promise<BounceSender[]> => {
  const senders = await readCampaignSenders(context, campaign, options.max);

  const read = await mapConcurrent(senders, async (sender) => ({
    counts: await options.read(sender.ref),
    sender,
  }));

  const over: BounceSender[] = read.flatMap(({ counts, sender }) =>
    counts !== null && isOver(counts, options.threshold)
      ? [
          {
            ...counts,
            address: sender.address,
            name: sender.name,
            sender: sender.ref,
          },
        ]
      : []
  );

  return over.toSorted((left, right) => (right.rate ?? 0) - (left.rate ?? 0));
};

const canCheckSenders = (context: InsightContext, wanted: boolean): boolean => {
  const { capabilities } = context.outbound;

  if (!wanted) {
    return false;
  }

  if (
    capabilities["stats.bySender"] === false ||
    !capabilities["senders.byCampaign"]
  ) {
    context.note(
      "Senders were not checked: the adapter needs stats per sender and the list of a campaign's senders."
    );

    return false;
  }

  return true;
};

export const bounceWatch = defineInsight({
  description:
    "Where bounces are too high: the campaigns whose bounce rate (bounced divided by sent) is over a threshold, worst first, each with bounced, sent, the rate and its Wilson interval, and the senders of each such campaign that are themselves over the threshold. Campaigns with too few sends to judge and campaigns with no reported bounce count are listed apart, never as clean. Use it daily, or when a domain's reputation is in doubt. Costs one listing of campaigns and 1 request per campaign, plus 1 listing and up to 1 request per sender for each campaign over the threshold. A null rate means nothing was sent.",
  inputSchema: input,
  key: "bounceWatch",
  name: "bounce_watch",
  needs: ["stats.campaign"],
  next: "Use domain_health on the senders named here, and settings_audit on the campaigns over the threshold.",
  run: async (context, options) => {
    const { outbound } = context;
    const { min_sent: minSent, threshold } = options;
    const range: Range = { from: options.from, to: options.to };

    const campaigns = await readCapped(
      context,
      (cap) => outbound.campaigns.listAll({ max: cap }),
      options.max_campaigns,
      "campaigns"
    );

    const withSenders =
      campaigns.length > 0 && canCheckSenders(context, options.include_senders);

    const read = senderReader(context, range);
    const overBy: { campaign: Campaign; entry: BounceCampaign }[] = [];
    const tooFewSends: BounceCampaign[] = [];
    const unknown: BounceUnknown[] = [];
    const counted: BounceCounts[] = [];

    const rows = await mapConcurrent(campaigns, async (campaign) => ({
      campaign,
      row: context.rows(await outbound.campaign(campaign.ref).stats(range))[0],
    }));

    for (const { campaign, row } of rows) {
      const counts = known(row);

      const entry = {
        campaign: campaign.ref,
        name: campaign.name,
        status: campaign.status,
      };

      if (counts === null) {
        unknown.push({ ...entry, reason: whyUnknown(row) });
      } else if (counts.sent < minSent || counts.sent === 0) {
        counted.push(counts);
        tooFewSends.push({
          ...entry,
          ...counts,
          finding: `${counts.bounced} of ${counts.sent} sends bounced; under ${minSent} sends is too few to judge.`,
          senders: null,
        });
      } else {
        counted.push(counts);

        if (isOver(counts, threshold)) {
          overBy.push({
            campaign,
            entry: {
              ...entry,
              ...counts,
              finding: `${counts.bounced} of ${counts.sent} sends bounced (${counts.rate}), over the ${threshold} threshold.`,
              senders: null,
            },
          });
        }
      }
    }

    const over = await mapConcurrent(
      overBy,
      async ({ campaign, entry }): Promise<BounceCampaign> =>
        withSenders
          ? {
              ...entry,
              senders: await sendersOver(context, campaign, {
                max: options.max_senders_per_campaign,
                read,
                threshold,
              }),
            }
          : entry
    );

    const bounced = total(counted.map((each) => each.bounced));
    const sent = total(counted.map((each) => each.sent));

    const byRate = (left: BounceCounts, right: BounceCounts): number =>
      (right.rate ?? -1) - (left.rate ?? -1);

    const answer: BounceWatch = {
      minSent,
      over: over.toSorted(byRate),
      threshold,
      tooFewSends: tooFewSends.toSorted(byRate),
      totals: {
        bounced,
        campaigns: campaigns.length,
        clean: counted.length - over.length - tooFewSends.length,
        over: over.length,
        rate: rate(bounced, sent),
        sent,
        tooFewSends: tooFewSends.length,
        unknown: unknown.length,
      },
      unknown,
    };

    return answer;
  },
});
