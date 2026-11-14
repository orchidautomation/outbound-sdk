import { createOutbound, OutboundError } from "outbound-sdk";
import type { Lead, Message } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { memoryCheckpointStore, sync } from "outbound-sdk/sync";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "agency" }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

// 1. Your database is down while the second page is being written.
let databaseUp = false;
const delivered: string[] = [];

const onPage = (leads: readonly Lead[]): void => {
  if (!databaseUp && delivered.length > 0) {
    throw new Error("database is down");
  }

  delivered.push(leads.map((lead) => lead.sourceId).join(", "));
};

try {
  await outbound.sync.run<Lead>("leads", { onPage });
} catch (error) {
  console.log("run 1 failed:", error instanceof Error ? error.message : error);
}

// The checkpoint is still before the page that failed, so it comes again.
databaseUp = true;

const retry = await outbound.sync.run<Lead>("leads", { onPage });

console.log("run 2 resumed:", retry.resumed, "pages:", retry.pages);

console.log("delivered:", delivered);

// 2. An adapter that cannot filter messages by date: every run reads them all.
const noDates = createOutbound({
  adapter: memory({
    capabilities: { "messages.since": false },
    data: seed,
    workspaceId: "agency",
  }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

const ignore = (_page: readonly Message[]): void => {
  // A real sync writes the page somewhere.
};

await noDates.sync.run<Message>("messages", { onPage: ignore });

const second = await noDates.sync.run<Message>("messages", { onPage: ignore });

console.log("no date filter:", second.since, second.records);

// 3. An adapter that cannot list replies refuses the sync.
const noReplies = createOutbound({
  adapter: memory({ capabilities: { "replies.list": false }, data: seed }),
  plugins: [sync({ checkpoints: memoryCheckpointStore() })],
});

try {
  await noReplies.sync.run("replies", { onPage: ignore });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no replies:", error.code, "-", error.message);
  }
}
