import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const campaign = await outbound.campaigns.get("cmp_founders");

console.log(JSON.stringify(campaign, null, 2));
