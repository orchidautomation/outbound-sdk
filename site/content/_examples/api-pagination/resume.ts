import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2 }),
});

// Stands in for your own storage: a database row, a file, a queue message.
let saved: string | undefined;
const handled: string[] = [];

const walk = outbound.leads.listAll();

try {
  for await (const lead of walk) {
    if (lead.sourceId === "lead_4") {
      throw new Error("the process died");
    }

    handled.push(lead.sourceId);
    // Save after each record. The cursor moves only when a page is done.
    saved = walk.cursor;
  }
} catch {
  console.log("handled before the crash:", handled);
}

// A new run starts from the saved cursor.
const again: string[] = [];

for await (const lead of outbound.leads.listAll({ cursor: saved })) {
  again.push(lead.sourceId);
}

console.log("handled after the restart:", again);
