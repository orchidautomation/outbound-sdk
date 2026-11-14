import { memory } from "outbound-sdk/memory";
import type { SyncResult } from "outbound-sdk/sync";

import { countRows, openDatabase } from "./database.ts";
import { later, seed } from "./seed.ts";
import { describe, syncAll, syncing } from "./sync-all.ts";

const db = openDatabase();
const HOUR = 3_600_000;

const report = (title: string, results: readonly SyncResult[]): void => {
  console.log(title);

  for (const result of results) {
    console.log(`  ${describe(result)}`);
  }

  console.log(
    `  rows: ${countRows(db, "campaigns")} campaigns, ${countRows(db, "leads")} leads, ${countRows(db, "replies")} replies\n`
  );
};

// 12:00. Nothing has been synced yet, so every record is read.
const first = syncing(memory({ data: seed, workspaceId: "acme" }), db);

report("First run", await syncAll(first, db));

// 13:00. The same account an hour later, and the same database.
const second = syncing(
  memory({ data: later, workspaceId: "acme" }),
  db,
  () => Date.now() + HOUR
);

report("Second run", await syncAll(second, db));
