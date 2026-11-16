import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.campaignRanking({});

for (const campaign of data.ranked) {
  console.log(
    `${campaign.rank}. ${campaign.campaignName}: ${campaign.count} of ${campaign.of} = ${campaign.rate}, interval ${campaign.low} to ${campaign.high}`
  );
}

console.log("gap:", data.gap);
