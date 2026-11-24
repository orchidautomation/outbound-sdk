import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { smartlead } from "outbound-sdk/smartlead";

import { fixtureFetch } from "../_shared/fixture-fetch.ts";
import { ROUTES } from "./routes.ts";

// The real Smartlead adapter. Its fetch answers from documented example
// payloads, so the replies are made up; set SMARTLEAD_API_KEY and drop the
// fetch option for real ones.
const vendor = fixtureFetch("smartlead", ROUTES);

const outbound = createOutbound({
  adapter: smartlead({ apiKey: "not-used", workspaceId: "client-a" }),
  fetch: vendor.fetch,
  plugins: [exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-replies-"));
const file = path.join(dir, "replies.jsonl");

// Every reply, newest first, one JSON object a line. `columns` keeps the
// file to the fields a warehouse table needs.
const result = await outbound.export(outbound.replies.listAll(), {
  columns: [
    "ref",
    "campaignRef",
    "leadEmail",
    "threadId",
    "sentAt",
    "category",
    "categorySource",
    "isAuto",
  ],
  to: file,
});

console.log(`${result.rows} replies`);

console.log(await readFile(file, "utf-8"));

console.log(`${vendor.requests.length} requests:`);

for (const request of vendor.requests) {
  console.log(`  ${request}`);
}

await rm(dir, { recursive: true });
