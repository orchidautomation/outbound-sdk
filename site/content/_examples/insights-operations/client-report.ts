import { outbound } from "./outbound.ts";

const { data, meta } = await outbound.insights.clientReport({});

console.log(data.totals.finding);

console.log(
  "top:",
  data.top.map((campaign) => campaign.campaignName).join(", ")
);

console.log(
  "bottom:",
  data.bottom.map((campaign) => campaign.campaignName).join(", ")
);

for (const item of data.actions) {
  console.log(`${item.kind}: ${item.action}`);
}

console.log("complete:", meta.complete, "left out:", data.leftOut);
