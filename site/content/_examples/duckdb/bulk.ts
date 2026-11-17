// A one-off load: export every lead and reply to JSON Lines, then let DuckDB
// read the files. Rows are written as they arrive, so the export never sits
// in memory, and DuckDB infers the columns from the records.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";
import { show } from "./warehouse.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-duckdb-"));
const file = (name: string): string => path.join(dir, `${name}.jsonl`);

const leads = await outbound.export(outbound.leads.listAll(), {
  columns: ["ref", "campaignRef", "email", "status", "createdAt"],
  to: file("leads"),
});

const replies = await outbound.export(outbound.replies.listAll(), {
  columns: ["ref", "campaignRef", "leadRef", "category", "sentAt"],
  to: file("replies"),
});

console.log(`exported ${leads.rows} leads and ${replies.rows} replies`);

const instance = await DuckDBInstance.create(":memory:");
const db = await instance.connect();

for (const name of ["leads", "replies"]) {
  // oxlint-disable-next-line no-await-in-loop -- one connection runs one statement at a time.
  await db.run(
    `CREATE TABLE ${name} AS SELECT * FROM read_json_auto('${file(name)}')`
  );
}

console.log("replies by campaign:");

await show(
  db,
  `SELECT campaignRef AS campaign,
          count(*)::INTEGER AS replies,
          (count(*) FILTER (category = 'positive'))::INTEGER AS positive
     FROM replies GROUP BY ALL ORDER BY campaign`
);

console.log("leads that replied positively:");

await show(
  db,
  `SELECT l.email, r.sentAt::DATE AS replied_on
     FROM leads l JOIN replies r ON r.leadRef = l.ref
    WHERE r.category = 'positive' ORDER BY replied_on`
);

await rm(dir, { recursive: true });
