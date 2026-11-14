import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { CAMPAIGN, seed } from "./seed.ts";

const outcome = async (
  name: string,
  read: Promise<object>
): Promise<string> => {
  try {
    await read;

    return `  ${name}: ok`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `  ${name}: ${error.code}: ${error.message}`;
  }
};

const tryAs = async (vendor: Vendor): Promise<string> => {
  const { insights: run } = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  const lines = await Promise.all([
    outcome("copyAudit", run.copyAudit({ campaign: CAMPAIGN })),
    outcome(
      "personalizationGaps",
      run.personalizationGaps({ campaign: CAMPAIGN })
    ),
    outcome("settingsAudit", run.settingsAudit({ statuses: ["draft"] })),
  ]);

  return [vendor, ...lines].join("\n");
};

const results = await Promise.all(VENDORS.map(tryAs));

console.log(results.join("\n"));
