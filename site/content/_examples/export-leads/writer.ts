import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { gzipJsonl } from "./gzip-writer.ts";
import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));
const file = path.join(dir, "leads.jsonl.gz");

const result = await outbound.export(outbound.leads.listAll(), {
  columns: ["ref", "email", "status"],
  to: gzipJsonl(file),
});

console.log(`${result.rows} rows handed to the writer`);

console.log(gunzipSync(await readFile(file)).toString("utf-8"));

await rm(dir, { recursive: true });
