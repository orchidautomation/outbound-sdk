import { createOutbound, resolveScope } from "outbound-sdk";
import type { Message } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { memoryCheckpointStore, sync } from "outbound-sdk/sync";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "agency" }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

// Which campaigns one client's scope covers, and how they were found.
const { campaigns, meta } = await resolveScope(outbound, { tag: "client-a" });

console.log(
  "scope:",
  campaigns.map((campaign) => campaign.name),
  meta.tools,
  meta.evidence
);

// Sync that client's messages only. Each campaign keeps its own checkpoint.
const result = await outbound.sync.run<Message>("messages", {
  onPage: (items) => {
    console.log(
      "page:",
      items.map((item) => item.campaignRef)
    );
  },
  tag: "client-a",
});

console.log(
  "run:",
  result.records,
  result.scope?.campaigns.map((each) => [each.name, each.records])
);
