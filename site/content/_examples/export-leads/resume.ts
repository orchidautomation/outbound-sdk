import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { exportLeadsFrom } from "./resumable.ts";
import type { ExportState } from "./resumable.ts";
import { seed } from "./seed.ts";

// Two leads a page, so five leads are three pages.
const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "acme" }),
});

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));
const file = path.join(dir, "leads.jsonl");
const state: ExportState = { done: false };
let rows = 0;

// The first attempt dies after its third row, in the middle of page two.
try {
  await exportLeadsFrom(outbound, file, state, () => {
    rows += 1;

    if (rows === 3) {
      throw new Error("process killed");
    }
  });
} catch (error) {
  console.log(`first attempt: ${String(error)}, ${rows} rows written`);
}

console.log(`a cursor was saved: ${state.cursor !== undefined}`);

// The second attempt starts from the saved cursor. Page two is read again.
const resumed = await exportLeadsFrom(outbound, file, state);

console.log(
  `second attempt: ${resumed.written} written, ${resumed.skipped} already in the file, done ${state.done}`
);

console.log(await readFile(file, "utf-8"));

await rm(dir, { recursive: true });
