import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { CAMPAIGN, seed } from "./seed.ts";
import { abVerdict } from "./verdict.ts";

const tryAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  try {
    const verdict = await abVerdict(outbound, CAMPAIGN);

    return `${vendor}: ok, ${verdict.split("\n").length} lines`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message}`;
  }
};

const lines = await Promise.all(VENDORS.map(tryAs));

console.log(lines.join("\n"));
