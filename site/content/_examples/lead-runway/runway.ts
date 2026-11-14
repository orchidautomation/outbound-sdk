import type { Outbound } from "outbound-sdk";
import type {
  InsightsExtension,
  PipelineForecast,
} from "outbound-sdk/insights";

export interface RunwayOptions {
  /** A campaign with this many days of leads left, or fewer, is flagged. */
  readonly warnDays?: number;
  /** The most active campaigns to forecast. Each is one insight call. */
  readonly maxCampaigns?: number;
  /** The most leads to read per campaign. A page of leads is one request. */
  readonly maxLeads?: number;
}

const whole = (value: number | null): string =>
  value === null ? "unknown" : String(Math.round(value));

const days = (forecast: PipelineForecast): string =>
  forecast.daysLeft === null
    ? "days left unknown"
    : `about ${forecast.daysLeft} days left at ${forecast.dailyContactRate} new leads a day`;

const replies = ({ expectedReplies }: PipelineForecast): string =>
  expectedReplies.expected === null
    ? "replies cannot be estimated yet"
    : `expect about ${whole(expectedReplies.expected)} more replies (${whole(expectedReplies.low)} to ${whole(expectedReplies.high)})`;

/** The active campaigns by how soon they run out of leads, as plain text. */
export const leadRunway = async (
  outbound: Outbound & InsightsExtension,
  { maxCampaigns = 25, maxLeads = 2000, warnDays = 5 }: RunwayOptions = {}
): Promise<string> => {
  const walk = outbound.campaigns.listAll({
    max: maxCampaigns,
    status: "active",
  });

  const campaigns = await walk.toArray();
  const forecasts: PipelineForecast[] = [];
  const notes = new Set<string>();
  let requests = 0;

  // pipelineForecast is one campaign per call, so this is one call each.
  for (const campaign of campaigns) {
    // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the vendor's rate budget predictable.
    const { data, meta } = await outbound.insights.pipelineForecast({
      campaign: campaign.ref,
      days: 7,
      max_leads: maxLeads,
    });

    forecasts.push(data);
    requests += meta.requests;

    for (const note of meta.notes) {
      notes.add(`${data.name}: ${note}`);
    }
  }

  // Soonest to run out first; a campaign with no pace to divide by goes last.
  const soonest = forecasts.toSorted(
    (left, right) =>
      (left.daysLeft ?? Number.POSITIVE_INFINITY) -
      (right.daysLeft ?? Number.POSITIVE_INFINITY)
  );

  const lines = [`Lead runway for ${campaigns.length} active campaigns`, ""];

  for (const forecast of soonest) {
    const flagged = forecast.daysLeft !== null && forecast.daysLeft <= warnDays;

    lines.push(
      `${flagged ? "ADD LEADS " : ""}${forecast.name}: ${forecast.leadsComplete ? "" : "at least "}${forecast.remaining} leads left, ${days(forecast)}`,
      `    ${replies(forecast)}`
    );
  }

  requests += walk.meta?.requests ?? 0;

  if (walk.truncated) {
    notes.add(`Stopped at ${maxCampaigns} campaigns; more are active.`);
  }

  if (notes.size > 0) {
    lines.push(
      "",
      "Read this before relying on the numbers:",
      ...[...notes].map((note) => `  - ${note}`)
    );
  }

  lines.push(
    "",
    "Every figure after the lead counts is an estimate. It assumes:",
    ...(soonest[0]?.assumptions.slice(0, 3) ?? []).map((text) => `  - ${text}`),
    "",
    `Vendor requests spent: ${requests}`
  );

  return lines.join("\n");
};
