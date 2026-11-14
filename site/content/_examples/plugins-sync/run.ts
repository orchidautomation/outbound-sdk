import { createOutbound } from "outbound-sdk";
import type { Lead } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { sync } from "outbound-sdk/sync";

import { seed } from "../plugins-index/seed.ts";
import { checkpoints } from "./store.ts";

const outbound = createOutbound({
  // Two leads per page, so the four leads are two pages.
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "agency" }),
  plugins: [sync({ checkpoints })],
});

// Your side of the sync: write the page to your database here.
const onPage = (leads: readonly Lead[]): void => {
  console.log("  page:", leads.map((lead) => lead.sourceId).join(", "));
};

console.log("run 1, stopped after one page:");

console.log(await outbound.sync.run<Lead>("leads", { maxPages: 1, onPage }));

console.log("run 2, picks up on the second page:");

console.log(await outbound.sync.run<Lead>("leads", { onPage }));

console.log(
  "run 3, asks only for leads created since run 1 began, less 5 minutes:"
);

console.log(await outbound.sync.run<Lead>("leads", { onPage }));

console.log("after reset, the next run starts over:");

await outbound.sync.reset("leads");

const again = await outbound.sync.run<Lead>("leads", { onPage });

console.log(again.records);
