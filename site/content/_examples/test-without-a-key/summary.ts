// The code under test: one line per active campaign.
import type { Outbound } from "outbound-sdk";

export interface CampaignLine {
  readonly name: string;
  readonly sent: number | null;
  readonly replyRate: number | null;
  /** `null` when the adapter cannot say which replies are positive. */
  readonly positiveReplies: number | null;
}

export const campaignSummary = async (
  outbound: Outbound
): Promise<CampaignLine[]> => {
  const lines: CampaignLine[] = [];

  for await (const campaign of outbound.campaigns.listAll({
    status: "active",
  })) {
    const handle = outbound.campaign(campaign.ref);
    const stats = await handle.stats();
    const [total] = stats.rows;
    const sent = total?.sent ?? null;
    const replied = total?.replied ?? null;

    const positive =
      outbound.capabilities["replies.category"] === false
        ? null
        : await handle.replies.listAll({ category: "positive" }).toArray();

    lines.push({
      name: campaign.name,
      positiveReplies: positive === null ? null : positive.length,
      replyRate:
        sent === null || replied === null || sent === 0 ? null : replied / sent,
      sent,
    });
  }

  return lines;
};
