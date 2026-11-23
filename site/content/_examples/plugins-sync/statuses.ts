import type { Lead } from "outbound-sdk";
import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { memoryCheckpointStore, sync } from "outbound-sdk/sync";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "agency" }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

// Back-fill the active campaigns first, then every other one. No campaign is
// read twice, and each keeps its own checkpoint, keyed by its ref.
for (const statuses of [
  ["active"],
  ["paused", "completed", "draft", "archived", "unknown"],
] as const) {
  const run = await outbound.sync.run<Lead>("leads", {
    onPage: (items, page) => {
      console.log("page:", page.campaignRef, items.length);
    },
    statuses: [...statuses],
  });

  console.log(
    statuses.join(","),
    run.scope?.campaigns.map((each) => [each.name, each.records]),
    run.notes[0]
  );
}
