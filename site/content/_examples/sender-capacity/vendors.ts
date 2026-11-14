import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { capacityFor } from "./plan.ts";
import { seed } from "./seed.ts";

const tryAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  try {
    const plan = await capacityFor(outbound, 40);
    const [, headroom] = plan.split("\n");

    return `${vendor}: ${headroom}`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message}`;
  }
};

const lines = await Promise.all(VENDORS.map(tryAs));

console.log(lines.join("\n"));
