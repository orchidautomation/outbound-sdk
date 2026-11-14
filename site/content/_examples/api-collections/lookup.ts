import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// A lookup by exact address. The SDK trims and lowercases it first.
const found = await outbound.leads.list({ email: " Person1@Example.com " });

for (const lead of found.items) {
  console.log(lead.ref, lead.campaignRef, lead.status);
}

const nobody = await outbound.leads.list({ email: "nobody@example.com" });

console.log("no match:", nobody.items.length, nobody.complete);
