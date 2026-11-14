import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { blockListReport, collisionReport } from "./overlap.ts";
import { emailTool } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: asVendor(vendor, emailTool, "agency"),
    plugins: [insights()],
  });

  for (const [name, report] of [
    ["leadCollisions", collisionReport],
    ["suppressionCheck", blockListReport],
  ] as const) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one read at a time.
      const text = await report(outbound);
      console.log(`${vendor} ${name}: ok, ${text.split("\n").length} lines`);
    } catch (error) {
      if (!OutboundError.is(error)) {
        throw error;
      }

      console.log(`${vendor} ${name}: ${error.code}: ${error.message}`);
    }
  }
}
