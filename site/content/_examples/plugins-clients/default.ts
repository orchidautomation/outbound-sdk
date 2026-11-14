import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { combine } from "outbound-sdk/combine";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// No rules: one workspace is one client.
const outbound = createOutbound({
  adapter: combine([
    memory({ data: seed, workspaceId: "acme" }),
    memory({
      data: { campaigns: [{ id: "cmp_1", name: "Globex launch" }] },
      workspaceId: "globex",
    }),
  ]),
  plugins: [clients()],
});

console.log("names:", outbound.clients.names());

for await (const campaign of outbound.campaigns.listAll()) {
  console.log(
    `${campaign.ref} -> ${"client" in campaign ? campaign.client : "?"}`
  );
}

// The scoped instance keeps the plugin and what it adds.
const acme = outbound.workspace("acme");

const stats = await acme.clients.stats({
  from: "2026-11-12",
  to: "2026-11-13",
});

console.log(stats.map((row) => `${row.client}: sent ${row.counts.sent}`));
