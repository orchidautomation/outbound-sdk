import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { exportLeads, exportReplies } from "./export.ts";
import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));
const csv = path.join(dir, "leads.csv");
const jsonl = path.join(dir, "replies.jsonl");

const leads = await exportLeads(outbound, csv);

console.log(`leads.csv: ${leads.rows} rows`);

console.log(await readFile(csv, "utf-8"));

const replies = await exportReplies(outbound, jsonl);

console.log(`replies.jsonl: ${replies.rows} rows`);

console.log(`columns: ${replies.columns.join(", ")}`);

console.log(await readFile(jsonl, "utf-8"));

await rm(dir, { recursive: true });
