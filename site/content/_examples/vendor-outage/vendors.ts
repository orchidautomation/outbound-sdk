import { OutboundError } from "outbound-sdk";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { build } from "./instance.ts";
import { seed } from "./seed.ts";

const outageAs = async (vendor: Vendor): Promise<string> => {
  const {
    outbound,
    pass,
    vendor: api,
  } = build({ adapter: asVendor(vendor, seed, "acme") });

  try {
    await outbound.campaigns.list();
    await outbound.stats();
    pass(10);
    api.fail("Provider");

    const campaigns = await outbound.campaigns.list();
    const stats = await outbound.stats();

    return `${vendor}: campaigns stale ${campaigns.meta.stale}, workspace stats stale ${stats.meta.stale}`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message}`;
  }
};

const lines = await Promise.all(VENDORS.map(outageAs));

console.log(lines.join("\n"));
