import { createOutbound } from "outbound-sdk";
import type { Adapter, JsonObject } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { insightTools } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";
import { createTools, TOOL_NAMES } from "outbound-sdk/tools";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { seed } from "./seed.ts";

// The real adapters, built to read what they declare. Nothing is requested.
const REAL: Record<Vendor, () => Adapter> = { heyreach, instantly, smartlead };

// A campaign by its ref, which any adapter takes; a vendor's own id has that vendor's form.
const inputFor = (vendor: Vendor) => {
  const campaign = `${vendor}:acme:cmp_founders`;

  return new Map<string, JsonObject>([
    ["campaign_setup", { campaign }],
    ["campaign_trend", { campaign, from: "2026-11-07", to: "2026-11-13" }],
    ["lead_runway", { campaign }],
    ["winning_steps", { campaign }],
  ]);
};

for (const vendor of VENDORS) {
  // The server offers createTools(outbound), then insightTools(outbound).
  const real = createOutbound({ adapter: REAL[vendor]() });
  const names = createTools(real).map((tool) => tool.name);

  console.log(
    `${vendor}: ${names.length} built-in tools, ${insightTools(real).length} insight tools, vendor_read ${names.includes("vendor_read") ? "offered" : "not offered"}`
  );

  const missing = TOOL_NAMES.filter(
    (name) => name !== "compare_clients" && name !== "cross_channel_lead"
  ).filter((name) => !names.includes(name));

  if (missing.length > 0) {
    console.log(`  not offered: ${missing.join(", ")}`);
  }

  // Call each built-in tool on seeded data limited to what the vendor declares.
  const limited = createOutbound({ adapter: asVendor(vendor, seed, "acme") });

  for (const tool of createTools(limited)) {
    // oxlint-disable-next-line no-await-in-loop -- one call at a time keeps the output in order.
    const result = await tool.call(inputFor(vendor).get(tool.name) ?? {});

    if (!result.ok) {
      console.log(
        `  ${tool.name}: ${result.error.code}: ${result.error.message}`
      );
    }
  }
}
