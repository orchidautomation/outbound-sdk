import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.periodComparison({});

console.log(
  `${data.current.from} to ${data.current.to}, against ${data.previous.from} to ${data.previous.to}`
);

for (const campaign of data.campaigns) {
  console.log(
    `${campaign.campaignName} (${campaign.verdict}): ${campaign.finding}`
  );
}

console.log(`all campaigns (${data.total.verdict}): ${data.total.finding}`);

console.log(
  "too few sends:",
  data.tooFewSends.map((campaign) => campaign.campaignName)
);
