import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";

// A stand-in vendor that answers 200 with an empty body, and a hook that
// prints each request the SDK sends.
const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: fakeVendor(200).fetch,
  hooks: {
    onRequest: (event) => {
      console.log("sent:", event.method, event.url);
    },
  },
});

console.log(outbound.raw.provider);

// A path on the vendor's API. The adapter adds the base URL and the key.
await outbound.raw.get("/campaigns", { query: { limit: 5, search: "q4" } });

// Instantly lists leads with POST. The adapter knows that one is a read.
await outbound.raw.request("POST", "/leads/list", { body: { limit: 5 } });

// Anything that is not a known read is refused before it is sent.
try {
  await outbound.raw.request("DELETE", "/campaigns/abc");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}
