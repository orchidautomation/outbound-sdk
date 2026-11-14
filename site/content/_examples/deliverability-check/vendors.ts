import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { deliverabilityCheck } from "./check.ts";
import { seed } from "./seed.ts";

const tryAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  try {
    const check = await deliverabilityCheck(outbound);

    return `${vendor}: ok, ${check.split("\n").length} lines`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message}`;
  }
};

const lines = await Promise.all(VENDORS.map(tryAs));

console.log(lines.join("\n"));
