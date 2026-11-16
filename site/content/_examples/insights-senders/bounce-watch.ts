import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.bounceWatch({});

for (const campaign of data.over) {
  console.log(`${campaign.campaignName}: ${campaign.finding}`);
  console.log(`  95% interval: ${campaign.low} to ${campaign.high}`);

  for (const sender of campaign.senders ?? []) {
    console.log(
      `  ${sender.address}: ${sender.bounced} of ${sender.sent} (${sender.rate})`
    );
  }
}

for (const campaign of data.tooFewSends) {
  console.log(`${campaign.campaignName}: ${campaign.finding}`);
}

for (const campaign of data.unknown) {
  console.log(`${campaign.campaignName}: ${campaign.reason}`);
}

console.log("totals:", data.totals);
