import { createOutbound, OutboundError } from "outbound-sdk";
import { budget } from "outbound-sdk/budget";
import { instantly } from "outbound-sdk/instantly";

import { documentedFetch, seen } from "./documented-fetch.ts";

// The in-memory adapter makes no vendor requests, so there is nothing for a
// budget to count. This runs Instantly's adapter on a fetch that serves the
// vendor's documented payloads from disk. Each page is one request.
const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  fetch: documentedFetch,
  // Three requests for the whole run, whatever the calls are.
  plugins: [budget({ maxRequests: 3, per: "run" })],
});

const all = await outbound.senders.listAll().toArray();

console.log(`listed ${all.length} mailboxes over two pages`);

console.log("used:", outbound.requestBudget.used());

console.log("remaining:", outbound.requestBudget.remaining());

// Two more pages do not fit in what is left.
try {
  await outbound.senders.listAll().toArray();
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`${error.code}: ${error.message}`);
}

console.log("used:", outbound.requestBudget.used());

// Nothing is left, so the next call stops before it reaches the vendor.
try {
  await outbound.senders.list();
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`${error.code}: ${error.message}`);
}

console.log("requests that reached the fetch:", seen.length);

outbound.requestBudget.reset();

console.log("after reset:", outbound.requestBudget.remaining());
