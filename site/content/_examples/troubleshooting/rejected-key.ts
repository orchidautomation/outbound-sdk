import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";

// A stand-in vendor that answers 401 with an empty body, as a vendor does
// for a key it does not accept.
const vendor = fakeVendor(401);

// Constructing with a wrong key works. Nothing is sent yet.
const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: vendor.fetch,
});

try {
  await outbound.campaigns.list();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
    console.log("status", error.status, "| requests", vendor.count());
  }
}
