import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { exportLeads } from "./export.ts";
import { seed } from "./seed.ts";

// For this sample only: read yours from a secret store, for example
// process.env.OUTBOUND_REDACT_KEY, which redact reads when no key is given.
const key = "sample-only-key-0123456789abcdef0123";

// `redact` is listed first, so it is outermost and nothing reaches the file
// unmasked. `hash` under a key keeps one token per value from one export to
// the next: rows can still be joined.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [redact({ key, strategy: "hash" }), exporter()],
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));
const file = path.join(dir, "leads.csv");

await exportLeads(outbound, file);

console.log(await readFile(file, "utf-8"));

await rm(dir, { recursive: true });
