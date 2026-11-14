import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// This adapter serves at most two records per page.
const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2 }),
});

const first = await outbound.leads.list();

console.log(
  first.items.map((lead) => lead.sourceId),
  "complete:",
  first.complete
);

// Pass the cursor back to the same listing for the next page.
const second = await outbound.leads.list({ cursor: first.cursor });

console.log(second.items.map((lead) => lead.sourceId));

const third = await outbound.leads.list({ cursor: second.cursor });

console.log(
  third.items.map((lead) => lead.sourceId),
  "complete:",
  third.complete,
  "cursor:",
  third.cursor
);

// `limit` is a hint. An adapter serves at most what its vendor allows.
const wide = await outbound.leads.list({ limit: 500 });

console.log("limit 500 returned", wide.items.length);

const narrow = await outbound.leads.list({ limit: 1 });

console.log("limit 1 returned", narrow.items.length);

// A cursor only works on the listing it came from.
try {
  await outbound.campaigns.list({ cursor: first.cursor });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

try {
  await outbound.leads.list({ limit: 0 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}
