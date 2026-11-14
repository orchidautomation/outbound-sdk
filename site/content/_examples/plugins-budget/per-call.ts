import { createOutbound, OutboundError } from "outbound-sdk";
import { budget } from "outbound-sdk/budget";
import { instantly } from "outbound-sdk/instantly";

import { documentedFetch } from "./documented-fetch.ts";

const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  fetch: documentedFetch,
  // `per` defaults to "call": every SDK call gets one request of its own.
  plugins: [budget({ maxRequests: 1 })],
});

const first = await outbound.senders.list();

console.log(
  "one page:",
  first.items.length,
  "mailboxes,",
  first.meta.requests,
  "request"
);

const second = await outbound.senders.list({ cursor: first.cursor });

console.log("next page, a new call:", second.items.length, "mailbox");

// One walk over both pages is one call, and needs two requests.
try {
  await outbound.senders.listAll().toArray();
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`${error.code}: ${error.message}`);
}

// Constructing the plugin with a cap that is not a positive integer fails.
try {
  budget({ maxRequests: 0 });
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`${error.code}: ${error.message}`);
}
