import { createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";

const outbound = createOutbound({
  adapter: combine([
    instantly({ apiKey: "example-key", workspaceId: "acme" }),
    heyreach({ apiKey: "example-key", workspaceId: "acme" }),
  ]),
  fetch: fakeVendor(200).fetch,
  hooks: {
    onRequest: (event) => {
      console.log("sent:", event.method, event.url);
    },
  },
});

// Two vendors are behind this instance, so there is no one API to call.
try {
  await outbound.raw.get("/campaigns");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

// The label alone still covers both tools, so name one member as
// `provider:workspace`.
const email = outbound.workspace("instantly:acme");

console.log(email.raw.provider);

await email.raw.get("/campaigns");
