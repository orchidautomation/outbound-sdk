import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.senderLoad({
  max_campaigns_per_sender: 2,
});

for (const sender of data.overused) {
  console.log("overused:", sender.finding);
}

console.log(
  "unused:",
  data.unused.map((sender) => sender.address)
);

for (const campaign of data.campaigns) {
  console.log(`${campaign.issues.join(", ")}: ${campaign.finding}`);
}

console.log("totals:", data.totals);
