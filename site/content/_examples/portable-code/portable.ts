import { computeRates } from "outbound-sdk";
import type { Outbound } from "outbound-sdk";

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${(rate * 100).toFixed(1)}%`;

// A count the vendor does not report is null, never 0.
const count = (value: number | null): string =>
  value === null ? "not reported" : String(value);

/**
 * A short account of one campaign that runs on any adapter. Each part first
 * reads `outbound.capabilities` and says so when the vendor cannot serve it.
 */
export const campaignBrief = async (
  outbound: Outbound,
  campaignId: string
): Promise<string[]> => {
  const { capabilities } = outbound;
  const campaign = outbound.campaign(campaignId);
  const lines: string[] = [];

  // 1. A filter has a grade. "server": the vendor filters. "client": the SDK
  //    reads every campaign and filters after, and the answer says `derived`.
  const walk = outbound.campaigns.listAll({ status: "active" });
  const active = await walk.toArray();

  lines.push(
    `active campaigns: ${active.length} (campaigns.status is "${capabilities["campaigns.status"]}", evidence ${walk.meta?.evidence})`
  );

  // 2. A stat has a grade too: "exact" from the vendor, "derived" when the
  //    adapter computes it, false when there is nothing to read.
  if (capabilities["stats.campaign"] === false) {
    lines.push("totals: this vendor has no campaign stats");
  } else {
    const stats = await campaign.stats();
    const [total] = stats.rows;

    lines.push(
      `totals: sent ${count(total?.sent ?? null)}, replied ${count(total?.replied ?? null)}, opened ${count(total?.opened ?? null)} (evidence ${stats.meta.evidence})`
    );
  }

  if (capabilities["stats.byStep"] === false) {
    lines.push("by step: this vendor has no per-step stats");
  } else {
    const { rows } = await campaign.stats({ scope: "step" });

    for (const row of rows) {
      // computeRates returns null for a rate whose counts are not reported.
      const { replyRate } = computeRates(row);

      lines.push(
        `by step: step ${row.stepIndex} sent ${count(row.sent)}, reply rate ${percent(replyRate.value)} of ${replyRate.basis}`
      );
    }
  }

  // 3. A plain yes or no.
  if (capabilities["campaigns.settings"]) {
    const settings = await campaign.settings();

    lines.push(
      `settings: daily limit ${count(settings.dailyLimit)}, open tracking ${settings.tracking.opens}`
    );
  } else {
    lines.push("settings: this vendor does not expose campaign settings");
  }

  // 4. Reply categories come from the vendor or not at all.
  if (capabilities["replies.category"] === "vendor") {
    const positive = await outbound.replies
      .listAll({ campaignId, category: "positive" })
      .toArray();

    lines.push(`positive replies: ${positive.length}`);
  } else {
    const replies = await outbound.replies.listAll({ campaignId }).toArray();

    lines.push(
      `replies: ${replies.length} (this vendor does not categorise replies)`
    );
  }

  return lines;
};
