import type { Lead } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { countRows, openDatabase, upsertLeads } from "./database.ts";
import { seed } from "./seed.ts";
import { syncing } from "./sync-all.ts";

const db = openDatabase();

// Two leads a page, so five leads are three pages.
const outbound = syncing(
  memory({ data: seed, pageSize: 2, workspaceId: "acme" }),
  db
);

let pages = 0;

// The second page is written, and then the process "dies" before the plugin
// can move its checkpoint.
try {
  await outbound.sync.run<Lead>("leads", {
    onPage: (leads) => {
      upsertLeads(db, leads);
      pages += 1;

      if (pages === 2) {
        throw new Error("connection lost");
      }
    },
  });
} catch (error) {
  console.log(`first run failed: ${String(error)}`);
}

console.log(`leads written so far: ${countRows(db, "leads")}`);

// The next run starts on the page that failed, not on the first one.
const resumed = await outbound.sync.run<Lead>("leads", {
  onPage: (leads) => {
    console.log(`  page: ${leads.map((lead) => lead.sourceId).join(", ")}`);
    upsertLeads(db, leads);
  },
});

console.log(
  `second run: resumed ${resumed.resumed}, ${resumed.records} records in ${resumed.pages} pages`
);

console.log(`leads in the database: ${countRows(db, "leads")}`);
