import assert from "node:assert/strict";

import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// Two records a page, so the five seeded leads are three pages. The default
// page size is 50, which would hide every paging bug in a small seed.
const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2 }),
});

const first = await outbound.leads.list();

assert.equal(first.items.length, 2);

assert.equal(first.complete, false);

assert.ok(first.cursor !== undefined);

console.log("ok - a page says it is not the last and gives a cursor");

const second = await outbound.leads.list({ cursor: first.cursor });
const third = await outbound.leads.list({ cursor: second.cursor });

assert.deepEqual(
  [...second.items, ...third.items].map((lead) => lead.sourceId),
  ["lead_3", "lead_4", "lead_5"]
);

assert.equal(third.complete, true);

assert.equal(third.cursor, undefined);

console.log("ok - the cursor continues where the page ended");

const everyLead = await outbound.leads.listAll().toArray();

assert.equal(everyLead.length, 5);

console.log("ok - listAll walks every page");

const capped = outbound.leads.listAll({ max: 3 });
const firstThree = await capped.toArray();

assert.equal(firstThree.length, 3);

assert.equal(capped.truncated, true);

console.log("ok - max stops the walk and says records were left");

// A cursor belongs to the listing that issued it.
await assert.rejects(
  outbound.campaigns.list({ cursor: first.cursor }),
  (error) => OutboundError.is(error) && error.code === "Invalid"
);

console.log("ok - a leads cursor is refused by campaigns");
