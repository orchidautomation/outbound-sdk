import { createOutbound } from "outbound-sdk";
import { insightTools, listInsights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";

const all = listInsights().map((insight) => insight.name);

// What each adapter declares, not what its API returned.
for (const vendor of VENDORS) {
  const outbound = createOutbound({ adapter: asVendor(vendor, {}) });
  const offered = new Set(insightTools(outbound).map((tool) => tool.name));
  const refused = all.filter((name) => !offered.has(name));

  console.log(
    `${vendor}: ${offered.size} of ${all.length}. Refuses: ${refused.join(", ") || "none"}`
  );
}
