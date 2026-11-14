import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    clients({
      // The first rule that matches decides.
      rules: [
        { campaignTag: "acme", client: "Acme" },
        { campaignName: /^Globex:/u, client: "Globex" },
      ],
    }),
  ],
});

console.log("clients:", outbound.clients.names());

for await (const campaign of outbound.campaigns.listAll()) {
  // The plugin adds `client` at run time. The Campaign type does not have it.
  console.log(
    `${campaign.name} -> ${"client" in campaign ? campaign.client : "?"}`
  );
}

// A lead has no tags of its own. It is assigned through its campaign.
for await (const lead of outbound.leads.listAll()) {
  console.log(`${lead.email} -> ${"client" in lead ? lead.client : "?"}`);
}

const stats = await outbound.clients.stats({
  from: "2026-11-12",
  to: "2026-11-13",
});

for (const row of stats) {
  console.log(
    `${row.client}: ${row.campaigns} campaign(s), sent ${row.counts.sent}, replied ${row.counts.replied}, bounced ${row.counts.bounced}`
  );
}
