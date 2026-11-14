import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { redact } from "outbound-sdk/redact";

import { fakeVendor } from "../retries/fake-vendor.ts";

const vendor = fakeVendor(200);

const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: vendor.fetch,
  plugins: [redact()],
});

console.log("native:", outbound.capabilities.native);

try {
  await outbound.native.read("auditLogs");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

console.log("requests sent:", vendor.count());
