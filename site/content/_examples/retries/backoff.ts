import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "./fake-vendor.ts";
import { instantClock } from "./instant-clock.ts";

// Two failures, then an empty 200.
const vendor = fakeVendor(503, 503, 200);

const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: vendor.fetch,
  hooks: {
    onRetry: (event) => {
      console.log(
        `attempt ${event.attempt} failed (${event.reason}), next in ${event.delayMs} ms`
      );
    },
  },
  runtime: instantClock(),
});

// `raw.get` hands back the response body as it is. Here that is `null`.
const body = await outbound.raw.get("/campaigns");

console.log("answer:", body, "after", vendor.count(), "requests");
