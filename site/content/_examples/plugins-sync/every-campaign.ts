import { createOutbound, resolveScope } from "outbound-sdk";
import type { Lead } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { memoryCheckpointStore, sync } from "outbound-sdk/sync";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "agency" }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

// Every campaign of the workspace: "*" is a glob that matches any name.
const every = await resolveScope(outbound, { campaign_name: "*" });

// Campaigns sync in the order of resolved.campaigns, so put active ones first.
const resolved = {
  ...every,
  campaigns: every.campaigns.toSorted(
    (a, b) => Number(b.status === "active") - Number(a.status === "active")
  ),
};

const leads = await outbound.sync.run<Lead>("leads", {
  onPage: (items, page) => {
    console.log("leads:", page.campaignRef, items.length);
  },
  resolved,
});

console.log(
  "order:",
  leads.scope?.campaigns.map((each) => each.name),
  leads.records
);
