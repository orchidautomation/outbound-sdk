import { createOutbound } from "outbound-sdk";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { campaignBrief } from "./portable.ts";
import { seed } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({ adapter: asVendor(vendor, seed, "acme") });

  // oxlint-disable-next-line no-await-in-loop -- one vendor at a time keeps the output in order.
  const lines = await campaignBrief(outbound, "cmp_founders");

  console.log(`${vendor}\n  ${lines.join("\n  ")}`);
}
