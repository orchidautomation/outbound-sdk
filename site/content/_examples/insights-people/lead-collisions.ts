import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.leadCollisions({});

for (const collision of data.collisions) {
  console.log(`${collision.scope}: ${collision.finding}`);
  console.log(
    `  still active in ${collision.stillActive} of ${collision.campaignCount}:`,
    collision.campaigns.map((each) => each.campaignName).join(", ")
  );
}

console.log("totals:", data.totals);
