import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { personBrief } from "./person.ts";
import { DANA, emailTool } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: asVendor(vendor, emailTool, "agency"),
    plugins: [insights()],
  });

  try {
    // oxlint-disable-next-line no-await-in-loop -- one vendor at a time.
    const brief = await personBrief(outbound, DANA);
    console.log(`${vendor}: ok, ${brief.split("\n").length} lines`);
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${vendor}: ${error.code}: ${error.message}`);
  }
}
