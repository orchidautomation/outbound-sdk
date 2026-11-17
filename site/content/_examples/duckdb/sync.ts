import type { DuckDBConnection } from "@duckdb/node-api";
// A scheduled load: the sync plugin walks each collection page by page,
// writes every page into DuckDB, and keeps its checkpoints in the same
// database, so the second run asks only for what is newer.
import { createOutbound } from "outbound-sdk";
import type { Adapter, Campaign, Lead, Reply } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { sync } from "outbound-sdk/sync";

import { later, seed } from "./seed.ts";
import {
  duckdbCheckpoints,
  openWarehouse,
  show,
  upsertCampaigns,
  upsertLeads,
  upsertReplies,
} from "./warehouse.ts";

const HOUR = 3_600_000;

const syncAll = async (
  adapter: Adapter,
  db: DuckDBConnection,
  now?: () => number
): Promise<void> => {
  const outbound = createOutbound({
    adapter,
    plugins: [sync({ checkpoints: duckdbCheckpoints(db), now })],
  });

  const results = [
    await outbound.sync.run<Campaign>("campaigns", {
      onPage: async (page) => await upsertCampaigns(db, page),
    }),
    await outbound.sync.run<Lead>("leads", {
      onPage: async (page) => await upsertLeads(db, page),
    }),
    await outbound.sync.run<Reply>("replies", {
      onPage: async (page) => await upsertReplies(db, page),
    }),
  ];

  for (const result of results) {
    console.log(
      `  ${result.collection}: ${result.records} record(s), lower bound ${result.since ?? "none"}`
    );
  }
};

const db = await openWarehouse();

console.log("First run");

await syncAll(memory({ data: seed, workspaceId: "acme" }), db);

console.log("Second run, an hour later");

await syncAll(
  memory({ data: later, workspaceId: "acme" }),
  db,
  () => Date.now() + HOUR
);

console.log("rows:");

await show(
  db,
  `SELECT (SELECT count(*) FROM campaigns)::INTEGER AS campaigns,
          (SELECT count(*) FROM leads)::INTEGER AS leads,
          (SELECT count(*) FROM replies)::INTEGER AS replies`
);
