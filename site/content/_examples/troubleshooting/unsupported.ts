import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

import { fakeVendor } from "../retries/fake-vendor.ts";

const vendor = fakeVendor(200);
const outbound = createOutbound({ adapter: heyreach(), fetch: vendor.fetch });

const show = async <Result>(call: () => Promise<Result>): Promise<void> => {
  try {
    await call();
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(error.code, "-", error.message);
    }
  }
};

// HeyReach cannot list a workspace's tags: a lead's tags come with the lead.
await show(() => outbound.tags.list());

await show(() => outbound.campaign("123").settings());

await show(() => outbound.campaign("123").stats({ scope: "step" }));

console.log("requests sent:", vendor.count());

// Ask before calling.
console.log(outbound.capabilities.tags, outbound.capabilities["leads.get"]);
