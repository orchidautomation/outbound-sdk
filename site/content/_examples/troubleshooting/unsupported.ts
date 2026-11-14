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

// HeyReach has no list of every lead: leads exist per campaign.
await show(() => outbound.leads.list());

await show(() => outbound.campaign("123").settings());

await show(() => outbound.campaign("123").stats({ scope: "step" }));

console.log("requests sent:", vendor.count());

// Ask before calling.
console.log(
  outbound.capabilities["leads.list"],
  outbound.capabilities["leads.byCampaign"]
);
