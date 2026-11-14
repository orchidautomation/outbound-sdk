import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

// The in-memory adapter with a small demo data set: no key, no network.
const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

for await (const campaign of outbound.campaigns.listAll({ status: "active" })) {
  console.log(campaign.name, campaign.ref);
}
