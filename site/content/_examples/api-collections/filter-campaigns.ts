import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// One client's campaigns, by tag. Matched whole, ignoring case.
const tagged = await outbound.campaigns.listAll({ tag: "Client-A" }).toArray();

console.log(
  "tag client-a:",
  tagged.map((campaign) => campaign.name)
);

// By a text the name contains, ignoring case. Both filters together keep
// the campaigns that match both.
const named = await outbound.campaigns
  .listAll({ name: "founders", tag: "client-a" })
  .toArray();

console.log(
  "name founders, tag client-a:",
  named.map((campaign) => campaign.name)
);

// Whether the vendor filters, or the listing is read and filtered after.
console.log(
  outbound.capabilities["campaigns.byName"],
  outbound.capabilities["campaigns.byTag"]
);
