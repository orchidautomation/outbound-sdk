import { outbound } from "../insights-operations/outbound.ts";

// The LinkedIn campaign in this data reports no bounce count.
const { data } = await outbound.insights.campaignRanking({
  metric: "bounce_rate",
});

console.log(
  "ranked:",
  data.ranked.map((campaign) => `${campaign.campaignName} ${campaign.rate}`)
);

for (const campaign of data.unknown) {
  console.log(`unknown: ${campaign.campaignName}. ${campaign.reason}`);
}
