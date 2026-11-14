import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { exportLeads } from "./export.ts";
import { seed } from "./seed.ts";

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "acme" }),
  plugins: [exporter()],
});

// 1. A file that is neither .csv nor .jsonl is refused.
try {
  await exportLeads(outbound, path.join(dir, "leads.parquet"));
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("wrong extension:", error.code, "-", error.message);
  }
}

// 2. The vendor fails on the second page. The error reaches the caller, and
//    the file is left holding the rows written before it.
let pages = 0;

const failsOnPageTwo: OutboundPlugin = {
  name: "fails-on-page-two",
  wrap: (operation, next, info) => {
    pages += 1;

    if (pages === 2) {
      throw new OutboundError("Provider", "The vendor responded 503", {
        provider: info.provider,
        status: 503,
      });
    }

    return next(operation);
  },
};

const flaky = createOutbound({
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "acme" }),
  plugins: [exporter(), failsOnPageTwo],
});

const partial = path.join(dir, "partial.csv");

try {
  await exportLeads(flaky, partial);
} catch (error) {
  if (OutboundError.is(error)) {
    const written = await readFile(partial, "utf-8");
    const lines = written.trim().split("\n");

    console.log(
      `vendor failed: ${error.code}, file left with ${lines.length - 1} of 5 rows`
    );
  }
}

// 3. `max` stops the walk early. The exporter does not know: ask the listing.
const capped = outbound.leads.listAll({ max: 3 });

const result = await outbound.export(capped, {
  columns: ["ref"],
  to: path.join(dir, "capped.csv"),
});

console.log(`capped: ${result.rows} rows, truncated ${capped.truncated}`);

// 4. A listing with no records still writes the file. Name the columns, or
//    the header is empty: they are otherwise taken from the first record.
const empty = path.join(dir, "empty.csv");

const none = await outbound.export(
  outbound.replies.listAll({ category: "unsubscribe" }),
  { columns: ["ref", "category"], to: empty }
);

console.log(
  `empty: ${none.rows} rows, file is ${JSON.stringify(await readFile(empty, "utf-8"))}`
);

await rm(dir, { recursive: true });
