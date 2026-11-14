import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { reconcile } from "outbound-sdk/reconcile";

import { openDatabase } from "./database.ts";
import { later, seed } from "./seed.ts";
import { syncAll, syncing } from "./sync-all.ts";

const db = openDatabase();

await syncAll(syncing(memory({ data: seed, workspaceId: "acme" }), db), db);

// An hour later lead_2 is gone from the vendor. No sync run will say so.
const outbound = createOutbound({
  adapter: memory({ data: later, workspaceId: "acme" }),
  plugins: [reconcile()],
});

const known = db
  .prepare("SELECT ref FROM leads")
  .all()
  .map((row) => String(row.ref));

const report = await outbound.reconcile.deletions({
  collection: "leads",
  known,
});

console.log(`listed ${report.listed} leads`);

console.log("deleted at the vendor:", report.deleted);

console.log("not in the database yet:", report.added);
