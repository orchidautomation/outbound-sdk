// The runway part of client_report: which active campaigns are out of leads
// to start, running out, or stalled, and the action items that name them.

import { plural } from "../../internal/numbers.ts";
import type { RunwayState } from "../../internal/runway.ts";
import type { InsightContext } from "../define.ts";
import { spoken } from "../stats.ts";
import type { CampaignPeriods } from "./period-comparison.ts";
import { readRunway } from "./pipeline-forecast.ts";
import { labelOf } from "./shared.ts";
import type { CampaignLabel } from "./shared.ts";

// How long the leads left to start last, for a sentence: "less than a day"
// when it rounds to nothing, so a runway of 0.03 days does not read as 0 days.
const startingLeft = (daysLeft: number | null): string => {
  if (daysLeft !== null && daysLeft < 0.05) {
    return "less than a day";
  }

  const days = spoken(daysLeft);

  return `about ${days} ${days === "1" ? "day" : "days"}`;
};

export interface LeadRunway extends CampaignLabel {
  /**
   * `draining`: leads left to start run out within `runway_days` at the
   * recent pace. `out_of_leads`: none is left to start. `stalled`: some are
   * left to start but none was started in the period, or the vendor reports
   * no count of leads started. The same state the `lead_runway` tool (an AI
   * tool from `outbound-sdk/tools`, not an insight) gives.
   */
  readonly state: Exclude<RunwayState, "unknown">;
  /** Active leads not yet started. Those partway through the sequence are `inSequence`. */
  readonly remaining: number;
  /** Active leads partway through the sequence. `null` when the vendor does not say which have started. */
  readonly inSequence: number | null;
  /** New leads started per day over the period. `null` when the vendor reports no daily count of leads started. */
  readonly dailyContactRate: number | null;
  /** An estimate: `remaining` at `dailyContactRate`. `null` when the pace is 0 or unknown. */
  readonly daysLeft: number | null;
}

export interface ActionItem {
  readonly kind:
    | "add_leads"
    | "check_anomaly"
    | "check_skipped_leads"
    | "check_stalled"
    | "fix_bounces"
    | "reply_rate_fell"
    | "review_campaign";
  /** The campaign's ref, or `null` when the item is about the whole account. */
  readonly campaign: string | null;
  readonly campaignName: string | null;
  readonly action: string;
  /** The number behind the item. For `add_leads` and `check_stalled`, the campaigns it names. */
  readonly number: number | null;
}

// The most campaigns a note or an action names before it counts the rest.
const NAMED = 10;

const named = (names: readonly string[]): string => {
  const shown = names.slice(0, NAMED);
  const rest = names.length - shown.length;

  return `${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
};

export interface Runways {
  readonly runningOut: readonly LeadRunway[];
  readonly stalled: readonly LeadRunway[];
}

export interface RunwayOptions {
  readonly days: number;
  readonly max_leads_per_campaign: number;
  readonly runway_days: number;
}

/** The active campaigns' runways: those running out, and those stalled. `null` when the adapter cannot serve them. */
export const readRunways = async (
  context: InsightContext,
  campaigns: readonly CampaignPeriods[],
  options: RunwayOptions
): Promise<Runways | null> => {
  const { capabilities } = context.outbound;

  if (
    !capabilities["leads.byCampaign"] ||
    capabilities["stats.byDay"] === false
  ) {
    return null;
  }

  const active = campaigns.flatMap(({ campaign }) =>
    campaign.status === "active" ? [campaign] : []
  );

  const forecasts = await context.each(
    active,
    async (campaign) => ({
      campaign,
      forecast: await readRunway(context, campaign, {
        activeOnly: true,
        days: options.days,
        leadsInput: "max_leads_per_campaign",
        leadsWhat: "leads of a campaign",
        maxLeads: options.max_leads_per_campaign,
      }),
    }),
    "active campaigns' leads"
  );

  const uncounted = forecasts.flatMap(({ campaign, forecast }) =>
    forecast.complete ? [] : [campaign.name]
  );

  if (uncounted.length > 0) {
    context.note(
      `The leads left were not fully counted for ${plural(uncounted.length, "active campaign")}, so runningOutOfLeads and stalled leave ${uncounted.length === 1 ? "it" : "them"} out: ${named(uncounted)}. Raise max_leads_per_campaign to count them.`
    );
  }

  const runways = forecasts.flatMap(({ campaign, forecast }) => {
    const { daysLeft, inSequence, pace, remaining, state } = forecast.runway;

    return forecast.complete && state !== "unknown"
      ? [
          {
            ...labelOf(campaign),
            dailyContactRate: pace,
            daysLeft,
            inSequence,
            remaining,
            state,
          },
        ]
      : [];
  });

  return {
    // A campaign with no lead left to start is first: it has stopped starting new ones already.
    runningOut: runways
      .filter(
        (runway) =>
          runway.state === "out_of_leads" ||
          (runway.state === "draining" &&
            (runway.daysLeft ?? Infinity) <= options.runway_days)
      )
      .toSorted(
        (left, right) =>
          Number(right.state === "out_of_leads") -
            Number(left.state === "out_of_leads") ||
          (left.daysLeft ?? 0) - (right.daysLeft ?? 0)
      ),
    stalled: runways.filter((runway) => runway.state === "stalled"),
  };
};

const oneRunwayAction = (runway: LeadRunway): string => {
  if (runway.state === "draining") {
    return `Add leads to ${runway.campaignName}: ${plural(runway.remaining, "lead")} ${runway.remaining === 1 ? "is" : "are"} left to start, ${startingLeft(runway.daysLeft)} at its recent pace.`;
  }

  const finishing = runway.inSequence ?? 0;

  return finishing > 0
    ? `Add leads to ${runway.campaignName}: no lead is left to start, and ${plural(finishing, "lead")} ${finishing === 1 ? "is" : "are"} finishing the sequence.`
    : `Add leads to ${runway.campaignName}: no lead is left to start, so it is not sending to anyone new.`;
};

// Every campaign that needs leads, in one item, so the runway cannot crowd out the rest of the list.
const runwayAction = (
  runways: readonly LeadRunway[],
  runwayDays: number
): ActionItem[] => {
  const [first] = runways;

  if (first === undefined) {
    return [];
  }

  const one = runways.length === 1;
  const out = runways.filter((runway) => runway.state === "out_of_leads");
  const draining = runways.filter((runway) => runway.state === "draining");

  const parts = [
    ...(out.length > 0
      ? [
          `${plural(out.length, "has", "have")} no lead left to start (${named(out.map((runway) => runway.campaignName))})`,
        ]
      : []),
    ...(draining.length > 0
      ? [
          `${plural(draining.length, "runs", "run")} out within ${plural(runwayDays, "day")} at the recent pace (${named(draining.map((runway) => `${runway.campaignName} in ${startingLeft(runway.daysLeft)}`))})`,
        ]
      : []),
  ];

  return [
    {
      action: one
        ? oneRunwayAction(first)
        : `Add leads to ${runways.length} campaigns: ${parts.join("; ")}.`,
      campaign: one ? first.campaign : null,
      campaignName: one ? first.campaignName : null,
      kind: "add_leads",
      number: runways.length,
    },
  ];
};

const stalledAction = (
  stalled: readonly LeadRunway[],
  days: number
): ActionItem[] => {
  const [first] = stalled;

  if (first === undefined) {
    return [];
  }

  const one = stalled.length === 1;

  return [
    {
      action: `Find out why ${one ? first.campaignName : `${stalled.length} campaigns (${named(stalled.map((runway) => runway.campaignName))})`} started no new lead in the last ${plural(days, "day")}, though ${one ? `${plural(first.remaining, "lead")} ${first.remaining === 1 ? "is" : "are"}` : "leads are"} left to start.`,
      campaign: one ? first.campaign : null,
      campaignName: one ? first.campaignName : null,
      kind: "check_stalled",
      number: stalled.length,
    },
  ];
};

/** The runway's action items: one for every campaign that needs leads, one for every stalled campaign. */
export const runwayActions = (
  runways: Runways,
  options: Pick<RunwayOptions, "days" | "runway_days">
): ActionItem[] => [
  ...runwayAction(runways.runningOut, options.runway_days),
  ...stalledAction(runways.stalled, options.days),
];
