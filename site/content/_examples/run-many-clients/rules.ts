import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { memory } from "outbound-sdk/memory";

import { agency } from "./seed.ts";

// One key, several clients. The first rule that matches decides; a record
// that matches no rule is "unassigned", never guessed into a client.
const outbound = createOutbound({
  adapter: memory({ data: agency, name: "emailtool", workspaceId: "agency" }),
  plugins: [
    clients({
      rules: [
        { campaignTag: "initech", client: "Initech" },
        { campaignName: /^Umbrella:/u, client: "Umbrella" },
      ],
    }),
  ],
});

console.log("clients:", outbound.clients.names());

for (const row of await outbound.clients.stats()) {
  console.log(
    `${row.client}: ${row.campaigns} campaigns, sent ${row.counts.sent}, replied ${row.counts.replied}`
  );
}

// Every record is tagged, not only campaigns. A lead gets its campaign's
// client. The plugin adds `client` at run time; it is not on the Lead type.
for (const lead of await outbound.leads.listAll().toArray()) {
  const client = "client" in lead ? lead.client : undefined;

  console.log(`${lead.email} -> ${String(client)}`);
}
