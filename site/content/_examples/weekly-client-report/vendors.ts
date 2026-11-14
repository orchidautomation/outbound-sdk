import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { weeklyReport } from "./report.ts";
import { seed } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  try {
    const report = await weeklyReport(outbound);
    console.log(`${vendor}: ok, ${report.split("\n").length} lines`);
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${vendor}: ${error.code}: ${error.message}`);
  }
}
