// sender_capacity: can the senders send what the campaigns ask.

import { z } from "zod";

import type { Campaign, MetricRow, Sender } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { rate, round, total } from "../stats.ts";
import {
  dayFrom,
  readCampaigns,
  readCampaignSenders,
  readCapped,
} from "./read.ts";

const input = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe("How many full days before today to average the sends over"),
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe(
      "The most active campaigns to read. Each costs up to 2 requests, or 3 when the vendor has no workspace totals."
    ),
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe(
      "The most senders to read for the workspace, and for each campaign"
    ),
});

export interface CapacityTotals {
  /** The sum of the daily limits of active senders. `null` when no active sender reports one. */
  readonly daily: number | null;
  readonly mailboxDaily: number | null;
  readonly linkedinDaily: number | null;
  readonly activeSenders: number;
  /** Active senders whose limit is counted in `daily`. */
  readonly withLimit: number;
  /** Active senders with no reported limit. They are not counted as 0. */
  readonly withoutLimit: number;
  readonly inactiveSenders: number;
}

export interface CapacityAsk {
  /** The sum of the daily limits of active campaigns. `null` when none reports one. */
  readonly daily: number | null;
  readonly campaigns: number;
  readonly withLimit: number;
  readonly withoutLimit: number;
}

export interface CapacitySends {
  /** Messages sent in the window divided by its days. A day the vendor has no row for counts as no sends. */
  readonly averageDaily: number | null;
  readonly total: number | null;
  readonly days: number;
  /** Days in the window the vendor reported a sent count for. */
  readonly daysWithData: number;
  readonly from: string;
  readonly to: string;
  /** `campaigns` when the sends were added up over the active campaigns read. */
  readonly scope: "campaigns" | "workspace";
}

export interface ShortCampaign {
  readonly campaign: string;
  readonly name: string;
  readonly dailyLimit: number;
  /** The sum of the daily limits of the campaign's active senders. A sender shared with another campaign is counted in full. */
  readonly senderCapacity: number;
  readonly shortBy: number;
  readonly senders: number;
  readonly activeSenders: number;
  readonly finding: string;
}

export interface SenderCapacity {
  readonly finding: string;
  readonly capacity: CapacityTotals;
  /** `null` when the adapter cannot read campaign settings. */
  readonly ask: CapacityAsk | null;
  /** `null` when the adapter has no daily stats. */
  readonly sends: CapacitySends | null;
  /** Average daily sends divided by daily capacity. */
  readonly utilization: number | null;
  /** The daily ask divided by daily capacity. Over 1 means the campaigns ask for more than the senders can send. */
  readonly askRatio: number | null;
  /** Campaigns whose own senders cannot cover their daily limit, largest gap first. `null` when it could not be checked. */
  readonly shortCampaigns: readonly ShortCampaign[] | null;
  /** Campaigns left out of `shortCampaigns` because a limit is not reported. */
  readonly uncheckedCampaigns: number | null;
}

interface CampaignRead {
  readonly campaign: Campaign;
  readonly dailyLimit: number | null;
  readonly senders: readonly Sender[] | null;
}

const limitsOf = (senders: readonly Sender[]): (number | null)[] =>
  senders.map((sender) => sender.dailyLimit);

const capacityOf = (senders: readonly Sender[]): CapacityTotals => {
  const active = senders.filter((sender) => sender.status === "active");
  const withLimit = active.filter((sender) => sender.dailyLimit !== null);

  const ofKind = (kind: Sender["kind"]): number | null =>
    total(limitsOf(active.filter((sender) => sender.kind === kind)));

  return {
    activeSenders: active.length,
    daily: total(limitsOf(active)),
    inactiveSenders: senders.length - active.length,
    linkedinDaily: ofKind("linkedin"),
    mailboxDaily: ofKind("mailbox"),
    withLimit: withLimit.length,
    withoutLimit: active.length - withLimit.length,
  };
};

const readOne = async (
  context: InsightContext,
  campaign: Campaign,
  maxSenders: number
): Promise<CampaignRead> => {
  const { capabilities } = context.outbound;

  const settings = capabilities["campaigns.settings"]
    ? context.one(await context.outbound.campaign(campaign.ref).settings())
    : null;

  return {
    campaign,
    dailyLimit: settings?.dailyLimit ?? null,
    // The senders are only compared with the campaign's own limit.
    senders:
      settings !== null && capabilities["senders.byCampaign"]
        ? await readCampaignSenders(context, campaign, maxSenders)
        : null,
  };
};

const dailyRows = async (
  context: InsightContext,
  campaigns: readonly Campaign[],
  range: { readonly from: string; readonly to: string }
): Promise<{ rows: MetricRow[]; scope: CapacitySends["scope"] } | null> => {
  const { outbound } = context;
  const { capabilities } = outbound;

  if (capabilities["stats.byDay"] === false) {
    context.note(
      "Average daily sends left out: the adapter has no daily stats."
    );

    return null;
  }

  if (capabilities["stats.workspace"] !== false) {
    return {
      rows: [...context.rows(await outbound.stats({ ...range, by: "day" }))],
      scope: "workspace",
    };
  }

  if (capabilities["stats.campaign"] === false) {
    context.note(
      "Average daily sends left out: the adapter has no workspace or campaign stats."
    );

    return null;
  }

  const rows: MetricRow[] = [];

  for (const campaign of campaigns) {
    rows.push(
      ...context.rows(
        // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
        await outbound.campaign(campaign.ref).stats({ ...range, by: "day" })
      )
    );
  }

  context.note(
    "Average daily sends cover the active campaigns read, not the whole workspace."
  );

  return { rows, scope: "campaigns" };
};

const readSends = async (
  context: InsightContext,
  campaigns: readonly Campaign[],
  days: number
): Promise<CapacitySends | null> => {
  const range = {
    from: dayFrom(context.now, -days),
    to: dayFrom(context.now, -1),
  };

  const read = await dailyRows(context, campaigns, range);

  if (read === null) {
    return null;
  }

  const sent = total(read.rows.map((row) => row.sent));

  const reported = read.rows.flatMap((row) =>
    row.date === null || row.sent === null ? [] : [row.date]
  );

  return {
    ...range,
    averageDaily: sent === null ? null : round(sent / days),
    days,
    daysWithData: new Set(reported).size,
    scope: read.scope,
    total: sent,
  };
};

const shortfallOf = (
  read: CampaignRead
): ShortCampaign | "unchecked" | null => {
  const active = (read.senders ?? []).filter(
    (sender) => sender.status === "active"
  );

  if (
    read.dailyLimit === null ||
    active.some((sender) => sender.dailyLimit === null)
  ) {
    return "unchecked";
  }

  const senderCapacity = total(limitsOf(active)) ?? 0;

  if (senderCapacity >= read.dailyLimit) {
    return null;
  }

  return {
    activeSenders: active.length,
    campaign: read.campaign.ref,
    dailyLimit: read.dailyLimit,
    finding: `${read.campaign.name} asks for ${read.dailyLimit} a day but its ${active.length} active senders can send ${senderCapacity}.`,
    name: read.campaign.name,
    senderCapacity,
    senders: read.senders?.length ?? 0,
    shortBy: read.dailyLimit - senderCapacity,
  };
};

const askOf = (reads: readonly CampaignRead[]): CapacityAsk => {
  const limits = reads.map((read) => read.dailyLimit);
  const withLimit = limits.filter((limit) => limit !== null).length;

  return {
    campaigns: reads.length,
    daily: total(limits),
    withLimit,
    withoutLimit: reads.length - withLimit,
  };
};

const findingOf = (
  capacity: CapacityTotals,
  ask: CapacityAsk | null,
  sends: CapacitySends | null
): string => {
  if (capacity.daily === null) {
    return "No active sender reports a daily limit, so capacity is unknown.";
  }

  const senders = `active ${capacity.withLimit === 1 ? "sender" : "senders"}`;

  // The sentence counts what the number counts: only senders with a reported limit.
  const parts = [
    capacity.withoutLimit === 0
      ? `${capacity.withLimit} ${senders} can send ${capacity.daily} a day.`
      : `The ${capacity.withLimit} ${senders} that ${capacity.withLimit === 1 ? "reports" : "report"} a daily limit can send ${capacity.daily} a day; ${capacity.withoutLimit} more ${capacity.withoutLimit === 1 ? "reports" : "report"} no limit and ${capacity.withoutLimit === 1 ? "is" : "are"} not counted.`,
  ];

  if (ask !== null && ask.daily !== null) {
    parts.push(
      ask.daily > capacity.daily
        ? `Active campaigns ask for ${ask.daily}, which is ${ask.daily - capacity.daily} more than that.`
        : `Active campaigns ask for ${ask.daily}, which fits.`
    );
  }

  if (sends !== null && sends.averageDaily !== null) {
    parts.push(
      `${sends.averageDaily} a day were sent on average over the last ${sends.days} days.`
    );
  }

  return parts.join(" ");
};

export const senderCapacity = defineInsight({
  description:
    "Whether the senders can send what the campaigns ask: total daily capacity (the daily limits of active senders added up), the total daily ask of active campaigns, the average messages sent per day over the last days, utilization, and the campaigns whose own senders cannot cover their daily limit. Use it before adding campaigns or when sends fall short. Costs one listing of senders and of active campaigns, then up to 2 requests per campaign and 1 for daily stats. A null means the vendor does not report the number; a sender or campaign with no reported limit is counted apart, never as 0.",
  inputSchema: input,
  key: "senderCapacity",
  name: "sender_capacity",
  needs: ["senders.list"],
  next: "Use sender_load to see which senders are shared by too many campaigns, or warmup_readiness before raising a sender's limit.",
  run: async (
    context,
    { days, max_campaigns: maxCampaigns, max_senders: maxSenders }
  ) => {
    const { outbound } = context;
    const { capabilities } = outbound;

    const senders = await readCapped(
      context,
      (cap) => outbound.senders.listAll({ max: cap }),
      maxSenders,
      "senders"
    );

    const campaigns = await readCampaigns(context, ["active"], maxCampaigns);
    const reads: CampaignRead[] = [];

    for (const campaign of campaigns) {
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      reads.push(await readOne(context, campaign, maxSenders));
    }

    const hasSettings = capabilities["campaigns.settings"];
    const canCompare = hasSettings && capabilities["senders.byCampaign"];

    if (!hasSettings) {
      context.note(
        "The daily ask and the campaigns short of senders were left out: the adapter cannot read campaign settings."
      );
    } else if (!canCompare) {
      context.note(
        "The campaigns short of senders were left out: the adapter cannot list a campaign's senders."
      );
    }

    const capacity = capacityOf(senders);
    const ask = hasSettings ? askOf(reads) : null;
    const sends = await readSends(context, campaigns, days);
    const shortfalls = reads.map(shortfallOf);

    const answer: SenderCapacity = {
      ask,
      askRatio: rate(ask?.daily ?? null, capacity.daily),
      capacity,
      finding: findingOf(capacity, ask, sends),
      sends,
      shortCampaigns: canCompare
        ? shortfalls
            .flatMap((each) =>
              each === null || each === "unchecked" ? [] : [each]
            )
            .toSorted((left, right) => right.shortBy - left.shortBy)
        : null,
      uncheckedCampaigns: canCompare
        ? shortfalls.filter((each) => each === "unchecked").length
        : null,
      utilization: rate(sends?.averageDaily ?? null, capacity.daily),
    };

    return answer;
  },
});
