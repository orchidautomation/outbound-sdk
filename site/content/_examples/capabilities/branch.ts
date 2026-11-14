import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundApi } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { demoData, memory } from "outbound-sdk/memory";

import { fakeVendor } from "../retries/fake-vendor.ts";

// Code that works on any adapter asks first.
const dailyLimit = async (
  outbound: OutboundApi,
  campaignId: string
): Promise<number | null> => {
  if (!outbound.capabilities["campaigns.settings"]) {
    return null;
  }

  const settings = await outbound.campaign(campaignId).settings();

  return settings.dailyLimit;
};

// The in-memory adapter with one capability turned off.
const limited = createOutbound({
  adapter: memory({
    capabilities: { "campaigns.settings": false },
    data: demoData(),
  }),
});

const full = createOutbound({ adapter: memory({ data: demoData() }) });

console.log("full:", await dailyLimit(full, "cmp_founders"));

console.log("limited:", await dailyLimit(limited, "cmp_founders"));

// Or call it and handle the refusal.
try {
  await limited.campaign("cmp_founders").settings();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

// HeyReach's API cannot read campaign settings. The refusal comes from the
// SDK, so the stand-in vendor behind this instance is never reached.
const vendor = fakeVendor(200);
const linkedin = createOutbound({ adapter: heyreach(), fetch: vendor.fetch });

try {
  await linkedin.campaign("123").settings();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

console.log("requests sent:", vendor.count());
