import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2 }),
});

// Every page, fetched one at a time as the loop asks for more.
for await (const lead of outbound.leads.listAll()) {
  console.log(lead.sourceId, lead.email);
}

// Or all of them in an array.
const all = await outbound.leads.listAll().toArray();

console.log("toArray:", all.length);

// `max` stops the walk. `truncated` says whether anything was left.
const capped = outbound.leads.listAll({ max: 3 });
const some = await capped.toArray();

console.log("max 3:", some.length, "truncated:", capped.truncated);

const enough = outbound.leads.listAll({ max: 5 });

await enough.toArray();

console.log("max 5:", "truncated:", enough.truncated);
