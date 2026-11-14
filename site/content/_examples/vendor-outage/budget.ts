import { OutboundError } from "outbound-sdk";

import { build } from "./instance.ts";

// This run may make three vendor requests.
const { outbound, pass } = build({ maxRequests: 3 });

await outbound.campaigns.list();

await outbound.campaign("cmp_founders").stats();

await outbound.campaign("cmp_agencies").stats();

console.log(
  `used ${outbound.requestBudget.used()}, remaining ${outbound.requestBudget.remaining()}`
);

// Ten minutes on the cache has expired, and the budget is spent. The cap is
// yours, not an outage, so failover does not answer for it: a read that
// succeeded before is refused like one that never did.
pass(10);

for (const [label, read] of [
  ["seen before", () => outbound.campaign("cmp_founders").stats()],
  ["not seen before", () => outbound.senders.list()],
] as const) {
  try {
    // oxlint-disable-next-line no-await-in-loop -- one read at a time keeps the output in order.
    await read();
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(`${label}: ${error.code} - ${error.message}`);
    }
  }
}

// A new run starts with a full budget.
outbound.requestBudget.reset();

const fresh = await outbound.campaign("cmp_founders").stats();

console.log(`after reset: stale ${fresh.meta.stale}`);
