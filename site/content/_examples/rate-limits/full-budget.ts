import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

import { documentedFetch } from "../shared-rate-budget/documented-fetch.ts";

const outbound = createOutbound({
  adapter: heyreach({ apiKey: "example" }),
  fetch: documentedFetch,
  hooks: {
    onThrottle: (event) => {
      console.log(`waiting ${event.waitMs} ms for the ${event.lane} budget`);
    },
  },
  rateLimitStore: new MemoryRateLimitStore(),
});

// HeyReach allows 15 requests per 2 seconds; at the default share that is 7.
for (let read = 0; read < 7; read += 1) {
  await outbound.campaigns.list();
}

// The eighth must wait for the window. With a deadline shorter than the
// wait, it fails at once instead of waiting.
try {
  await outbound.campaigns.list({ deadline: 500 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(
      error.code,
      error.timedOut,
      `retry in ${error.retryAfterMs} ms`
    );
    console.log(error.message);
  }
}
