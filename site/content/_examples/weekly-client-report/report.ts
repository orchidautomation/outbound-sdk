import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${Math.round(rate * 1000) / 10}%`;

// A count the vendor does not report is null, never 0. Say so.
const count = (value: number | null): string =>
  value === null ? "not reported" : String(value);

/** The week for one client as plain text, ready to paste into an email. */
export const weeklyReport = async (
  outbound: Outbound & InsightsExtension
): Promise<string> => {
  const { data, meta } = await outbound.insights.clientReport({ days: 7 });

  const { current, previous } = data.totals;

  const lines = [
    `Outbound report for ${outbound.workspaceId}: ${data.period.from} to ${data.period.to}`,
    "",
    `Sent ${count(current.sent)}, replies ${count(current.replied)}, bounces ${count(current.bounced)}`,
    // A week's rates are per message sent (`data.replyRateBasis`).
    `Replies per message sent ${percent(current.replyRate)} (the week before: ${percent(previous.replyRate)})`,
    data.totals.finding,
    "",
    "Best campaigns:",
    ...data.top.map(
      (campaign) =>
        `  ${campaign.rank}. ${campaign.campaignName}: ${percent(campaign.rate)} (${campaign.count} replies to ${campaign.of} messages)`
    ),
    "",
    "To do:",
    ...data.actions.map((item) => `  - ${item.action}`),
  ];

  // An answer cut short by a cap, or built on a count the vendor estimates,
  // says so. Pass that on instead of presenting it as the whole picture.
  if (!meta.complete || meta.notes.length > 0) {
    lines.push(
      "",
      "Read this before relying on the numbers:",
      ...meta.notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
