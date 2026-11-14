import { createOutbound, OutboundError } from "outbound-sdk";
import { benchmarks } from "outbound-sdk/benchmarks";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { diagnose } from "./diagnose.ts";
import { CAMPAIGN, seed } from "./seed.ts";

const tryAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights(), benchmarks()],
  });

  try {
    const diagnosis = await diagnose(outbound, CAMPAIGN);

    const findings = diagnosis
      .split("\n")
      .filter((line) => line.startsWith("["));

    const notChecked = diagnosis.includes("Not checked:")
      ? "some checks not run"
      : "every check run";

    return `${vendor}: ok, ${findings.length} findings, ${notChecked}`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message}`;
  }
};

const lines = await Promise.all(VENDORS.map(tryAs));

console.log(lines.join("\n"));
