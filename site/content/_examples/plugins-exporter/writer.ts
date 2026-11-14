import { createOutbound, OutboundError } from "outbound-sdk";
import type { Lead } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import type { RowWriter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [exporter()],
});

// A writer is two async functions. This one collects rows in batches of
// three, the way an insert into DuckDB or a Parquet row group would.
const batchWriter = (label: string): RowWriter => {
  const batches: number[] = [];
  let batch: string[] = [];

  return {
    close: () => {
      if (batch.length > 0) {
        batches.push(batch.length);
      }

      console.log(`${label}: closed after batches of`, batches);

      return Promise.resolve();
    },
    write: (row) => {
      batch.push(String(row.ref));

      if (batch.length === 3) {
        batches.push(batch.length);
        batch = [];
      }

      return Promise.resolve();
    },
  };
};

const result = await outbound.export(outbound.leads.listAll(), {
  to: batchWriter("all leads"),
});

console.log("rows:", result.rows);

// A path that is neither .csv nor .jsonl is refused.
try {
  await outbound.export(outbound.leads.listAll(), { to: "leads.parquet" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}

// A source that fails part way: the error reaches you, and the writer is
// closed with the rows it already has.
const interrupted = async function* interrupted(): AsyncGenerator<Lead> {
  yield* outbound.leads.listAll({ max: 2 });

  throw new Error("connection lost");
};

try {
  await outbound.export(interrupted(), { to: batchWriter("interrupted") });
} catch (error) {
  console.log("failed:", error instanceof Error ? error.message : error);
}
