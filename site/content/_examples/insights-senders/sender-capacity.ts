import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.senderCapacity({});

console.log(data.finding);

console.log("capacity:", data.capacity);

console.log("ask:", data.ask);

console.log(
  `utilization ${data.utilization}, ask ratio ${data.askRatio}, sends counted over ${data.sends?.daysWithData} days`
);

for (const campaign of data.shortCampaigns ?? []) {
  console.log(`short by ${campaign.shortBy}: ${campaign.finding}`);
}

console.log("campaigns not checked:", data.uncheckedCampaigns);
