import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

const day = (time: string | null): string =>
  time === null ? "never" : time.slice(0, 10);

/** One person across every campaign and tool the instance reads, as text. */
export const personBrief = async (
  outbound: Outbound & InsightsExtension,
  person: string
): Promise<string> => {
  const { data, meta } = await outbound.insights.personSummary({ person });

  if (!data.found) {
    return `${person}: no record carries this identifier.`;
  }

  const lines = [
    `${person}: ${data.totals.campaigns} campaigns, ${data.totals.messagesSent} messages sent, ${data.totals.replies} replies`,
    `Known as: ${data.identifiers.join(", ")}`,
    "",
    ...data.campaigns.map(
      (campaign) =>
        `  ${campaign.channel} via ${campaign.provider}: ${campaign.campaignName ?? "no campaign"} (${campaign.campaignStatus ?? "unknown"})\n` +
        `    sent ${campaign.messagesSent}, replies ${campaign.replies}, last contacted ${day(campaign.lastContactedAt)}, last reply ${day(campaign.lastRepliedAt)}${
          campaign.interest === null ? "" : `, marked ${campaign.interest}`
        }`
    ),
    "",
    ...Object.entries(data.totals.byChannel).map(
      ([channel, counts]) =>
        `${channel}: ${counts.messagesSent} sent, ${counts.replies} replies`
    ),
  ];

  // A cap that stopped the read, or a count taken from the lead's last step,
  // is said here. Pass it on.
  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};
