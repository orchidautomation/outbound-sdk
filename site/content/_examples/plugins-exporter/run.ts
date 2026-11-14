import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));
const csv = path.join(dir, "leads.csv");

// Any listing works as the source. Pages are fetched as rows are written.
const result = await outbound.export(outbound.leads.listAll(), {
  columns: ["ref", "email", "firstName", "company", "custom"],
  to: csv,
});

console.log(result);

console.log(await readFile(csv, "utf-8"));

// JSON Lines, with the default columns: every field of the first record
// except `raw`.
const jsonl = path.join(dir, "campaigns.jsonl");

const campaigns = await outbound.export(outbound.campaigns.listAll(), {
  to: jsonl,
});

console.log(campaigns.columns.join(", "));

const lines = await readFile(jsonl, "utf-8");

console.log(lines.split("\n")[0]);

await rm(dir, { force: true, recursive: true });
