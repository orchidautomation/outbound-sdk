import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "../plugins-index/seed.ts";

// Mask who the person is, keep where they work, and keep people countable.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    redact({ fields: ["email", "name", "linkedin"], strategy: "hash" }),
  ],
});

for await (const lead of outbound.leads.listAll({ max: 2 })) {
  console.log(lead.email, "|", lead.firstName, "|", lead.company);
}

// The same address always becomes the same token.
const again = await outbound.lead("lead_jane").get();

console.log(again.email);

// Bodies are not in `fields`, so they can still be asked for.
console.log("messages.body:", outbound.capabilities["messages.body"]);
