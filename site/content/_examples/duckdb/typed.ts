// A typed load: export with `record`, so every row has every field of a
// reply whichever vendor sent it, and create the table from the record's
// schema, so a column no vendor has filled yet keeps its type.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { createOutbound } from "outbound-sdk";
import { duckdbTable, exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";
import { show } from "./warehouse.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-duckdb-"));
const file = path.join(dir, "replies.jsonl");

const { columns, rows } = await outbound.export(outbound.replies.listAll(), {
  record: "reply",
  to: file,
});

console.log(`exported ${rows} replies with ${columns.length} columns`);

const instance = await DuckDBInstance.create(":memory:");
const db = await instance.connect();

await db.run(duckdbTable("reply", { table: "replies" }));

await db.run(`COPY replies FROM '${file}'`);

console.log("a few columns and their types:");

await show(
  db,
  `SELECT column_name, data_type
     FROM information_schema.columns
    WHERE table_name = 'replies'
      AND column_name IN ('ref', 'sentAt', 'leftCompany', 'stepIndex')
    ORDER BY column_name`
);

console.log("replies per campaign:");

await show(
  db,
  `SELECT campaignRef AS campaign, count(*)::INTEGER AS replies,
          count(leftCompany)::INTEGER AS left_company_known
     FROM replies GROUP BY ALL ORDER BY campaign`
);

await rm(dir, { recursive: true });
