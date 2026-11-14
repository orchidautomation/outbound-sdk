import { outbound } from "../insights-operations/outbound.ts";

// Five campaigns exist. The cap stops the read after two.
const answer = await outbound.insights.campaignRanking({ max_campaigns: 2 });

console.log("insight:", answer.insight);

console.log(
  "data.ranked:",
  answer.data.ranked.map((campaign) => `${campaign.rank}. ${campaign.name}`)
);

console.log("meta:", answer.meta);
