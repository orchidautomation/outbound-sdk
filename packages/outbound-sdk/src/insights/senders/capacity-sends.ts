// What sender_capacity reads about sends: the daily sends over the window,
// and how many came from senders not counted in capacity, so the share in
// use compares sends and capacity over the same senders.

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Campaign, MetricRow, Sender } from "../../internal/entities.ts";
import type { Capped } from "../capped.ts";
import type { InsightContext } from "../define.ts";
import { round, total } from "../stats.ts";
import { dayFrom } from "./read.ts";

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
  /**
   * Sends in `total` from senders not counted in capacity: inactive, with no
   * daily limit, or past `max_senders`. `utilization` leaves them out. `null`
   * when they could not be told apart, and then `utilization` is `null` too.
   */
  readonly fromUncounted: number | null;
}

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

  const perCampaign = await mapConcurrent(campaigns, async (campaign) =>
    context.rows(
      await outbound.campaign(campaign.ref).stats({ ...range, by: "day" })
    )
  );

  const rows: MetricRow[] = perCampaign.flat();

  context.note(
    "Average daily sends cover the active campaigns read, not the whole workspace."
  );

  return { rows, scope: "campaigns" };
};

const UNTOLD =
  "Capacity in use left out: some sends may come from senders not counted in capacity (inactive, with no daily limit, or past max_senders), and they could not be told apart.";

/**
 * What the senders not counted in capacity sent in the window, so the share
 * in use compares sends and capacity over the same senders. 0 when every
 * sender is counted; `null`, with a note, when it cannot be told.
 */
const uncountedSends = async (
  context: InsightContext,
  senders: Capped<Sender>,
  window: {
    readonly from: string;
    readonly to: string;
    readonly scope: string;
    /** What the window's rows add up to, all senders together. */
    readonly sent: number;
  }
): Promise<number | null> => {
  const others = senders.items.filter(
    (sender) => sender.status !== "active" || sender.dailyLimit === null
  );

  if (!senders.capped && others.length === 0) {
    return 0;
  }

  // A sender's stats cover all its campaigns, so they split workspace totals only.
  const each =
    senders.capped ||
    window.scope !== "workspace" ||
    context.outbound.capabilities["stats.bySender"] === false
      ? [null]
      : await mapConcurrent(others, async (sender) =>
          total(
            context
              .rows(
                await context.outbound
                  .sender(sender.ref)
                  .stats({ from: window.from, to: window.to })
              )
              .map((row) => row.sent)
          )
        );

  const sent = total(each) ?? 0;

  // More than everyone sent means the two reads do not count alike.
  if (each.includes(null) || sent > window.sent) {
    context.note(UNTOLD);

    return null;
  }

  return sent;
};

export const readSends = async (
  context: InsightContext,
  campaigns: readonly Campaign[],
  days: number,
  senders: Capped<Sender>
): Promise<CapacitySends | null> => {
  const range = {
    from: dayFrom(context.now, -days),
    to: dayFrom(context.now, -1),
  };

  const read = await dailyRows(context, campaigns, range);

  if (read === null) {
    return null;
  }

  // A row dated outside the window asked for is not a send in it.
  const rows = read.rows.filter(
    (row) =>
      row.date === null || (row.date >= range.from && row.date <= range.to)
  );

  const sent = total(rows.map((row) => row.sent));

  const fromUncounted =
    sent === null
      ? null
      : await uncountedSends(context, senders, {
          ...range,
          scope: read.scope,
          sent,
        });

  const reported = rows.flatMap((row) =>
    row.date === null || row.sent === null ? [] : [row.date]
  );

  return {
    ...range,
    averageDaily: sent === null ? null : round(sent / days),
    days,
    daysWithData: new Set(reported).size,
    fromUncounted,
    scope: read.scope,
    total: sent,
  };
};
