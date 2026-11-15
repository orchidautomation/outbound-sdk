import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { documentedFetch } from "../plugins-budget/documented-fetch.ts";

// Instantly's adapter on a fetch that serves the vendor's documented two
// pages of mailboxes from disk. Each page is one request.
const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  fetch: documentedFetch,
});

let cursor: string | undefined;

try {
  // One request allowed: the second page is never asked for.
  await outbound.senders.listAll({ maxRequests: 1 }).toArray();
} catch (error) {
  if (!OutboundError.is(error) || error.partial === undefined) {
    throw error;
  }

  console.log(`${error.code}, limit ${error.limit}`);
  console.log(
    `kept ${error.partial.items.length} mailboxes after ${error.partial.requests} request(s)`
  );
  ({ cursor } = error.partial);
}

// Later, or with a higher cap: carry on from where it stopped.
const rest = await outbound.senders.listAll({ cursor }).toArray();

console.log(`the rest: ${rest.length} mailbox(es)`);
