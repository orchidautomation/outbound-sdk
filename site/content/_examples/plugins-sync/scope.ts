import { createOutbound, resolveScope } from "outbound-sdk";
import type { Lead, Message } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { memoryCheckpointStore, sync } from "outbound-sdk/sync";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "agency" }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

// Which campaigns one client's scope covers, and how they were found.
const resolved = await resolveScope(outbound, { tag: "client-a" });

console.log(
  "scope:",
  resolved.campaigns.map((campaign) => campaign.name),
  resolved.meta.tools,
  resolved.meta.evidence
);

// Sync that client's messages, then its leads, with the scope found once.
// Each campaign keeps its own checkpoint, and each page names its campaign.
const messages = await outbound.sync.run<Message>("messages", {
  onPage: (items, page) => {
    console.log("page:", page.campaignRef, items.length);
  },
  resolved,
});

const leads = await outbound.sync.run<Lead>("leads", {
  onPage: (items, page) => {
    console.log("leads:", page.campaignRef, items.length);
  },
  resolved,
});

console.log(
  "run:",
  messages.records,
  messages.scope?.campaigns.map((each) => [each.name, each.records]),
  leads.records,
  messages.inboxLeftOut
);
