// Whether a row's open and click counts were measured at all.
//
// The rule: a count is a number only when every campaign behind it measured
// it. A campaign measured opens when open tracking is on, or when it is off
// now but opens were recorded over the range (vendors report only the
// current setting, so those opens came in while tracking was on). Opens and
// clicks are judged separately, and each campaign once over the whole range,
// so a daily series never mixes 0 and `null`. When a setting is unknown the
// rows are left as the vendor sent them.

import type { MetricRow, MetricTracking, TrackingState } from "./entities.ts";
import { OutboundError } from "./errors.ts";

/** A campaign's tracking settings as the vendor reports them now. */
export interface TrackingFlags {
  readonly clicks: boolean | null;
  readonly opens: boolean | null;
}

/** One campaign behind a row: its settings and what it recorded in the range. */
export interface CampaignTracking {
  readonly flags: TrackingFlags;
  /** Messages sent in the range. A campaign that sent nothing is left out. */
  readonly sent: number | null;
  /** Opens recorded in the range, unique or total. */
  readonly opened: number | null;
  /** Clicks recorded in the range, unique or total. */
  readonly clicked: number | null;
}

interface Verdict {
  readonly state: TrackingState;
  readonly measured: boolean;
}

type Metric = keyof TrackingFlags;

const recorded = (campaign: CampaignTracking, metric: Metric): number =>
  (metric === "opens" ? campaign.opened : campaign.clicked) ?? 0;

const stateOf = (flags: readonly boolean[]): TrackingState => {
  if (flags.every(Boolean)) {
    return "on";
  }

  return flags.some(Boolean) ? "mixed" : "off";
};

const judge = (
  campaigns: readonly CampaignTracking[],
  metric: Metric
): Verdict | null => {
  const sending = campaigns.filter((campaign) => campaign.sent !== 0);
  const flags = sending.map((campaign) => campaign.flags[metric]);

  if (flags.length === 0 || flags.some((flag) => flag === null)) {
    return null;
  }

  return {
    measured: sending.every(
      (campaign) =>
        campaign.flags[metric] === true || recorded(campaign, metric) > 0
    ),
    state: stateOf(flags.filter((flag) => flag !== null)),
  };
};

const sumOf = (
  values: readonly (number | null | undefined)[]
): number | null => {
  let total: number | null = null;

  for (const value of values) {
    if (value !== null && value !== undefined) {
      total = (total ?? 0) + value;
    }
  }

  return total;
};

/**
 * One campaign's part in its own rows (an overview, its days or its steps):
 * what those rows recorded over the range.
 */
export const ownTracking = (
  flags: TrackingFlags,
  rows: readonly MetricRow[]
): CampaignTracking => ({
  clicked: sumOf(rows.flatMap((row) => [row.clicked, row.clickedTotal])),
  flags,
  opened: sumOf(rows.flatMap((row) => [row.opened, row.openedTotal])),
  sent: null,
});

const unmeasured = (verdict: Verdict | null): boolean =>
  verdict !== null && !verdict.measured;

/**
 * Sets each row's `tracking` and makes the counts the campaigns did not
 * measure `null`. `null` campaigns (the settings could not be read) leave the
 * rows unchanged.
 */
export const applyTracking = (
  rows: readonly MetricRow[],
  campaigns: readonly CampaignTracking[] | null
): MetricRow[] => {
  if (campaigns === null) {
    return [...rows];
  }

  const opens = judge(campaigns, "opens");
  const clicks = judge(campaigns, "clicks");

  if (opens === null && clicks === null) {
    return [...rows];
  }

  const tracking: MetricTracking = {
    clicks: clicks?.state ?? null,
    opens: opens?.state ?? null,
  };

  const noOpens = unmeasured(opens);
  const noClicks = unmeasured(clicks);

  return rows.map((row) => ({
    ...row,
    clicked: noClicks ? null : row.clicked,
    clickedTotal: noClicks ? null : row.clickedTotal,
    opened: noOpens ? null : row.opened,
    openedTotal: noOpens ? null : row.openedTotal,
    tracking,
  }));
};

/**
 * Runs a read of tracking settings. A vendor error gives `null`, which
 * leaves the counts as they are: the stats themselves were read, and a
 * failed extra read should not cost the caller them.
 */
export const unlessFailed = async <Value>(
  read: () => Promise<Value>
): Promise<Value | null> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof OutboundError) {
      return null;
    }

    throw error;
  }
};
