import { createOutbound } from "outbound-sdk";
import type { Adapter, NativeCatalog, NativeRead } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";
import { createTools } from "outbound-sdk/tools";

import { asVendor } from "../_shared/as-vendor.ts";

// Built from a real adapter to read its catalog. No request is made.
const describe = <Native extends NativeCatalog>(
  adapter: Adapter<Native>
): void => {
  const outbound = createOutbound({ adapter });
  const reads: NativeRead[] = Object.values(outbound.native.catalog);

  console.log(
    `${outbound.provider}: native ${outbound.capabilities.native},`,
    reads.length,
    "reads,",
    reads.filter((read) => read.method === "POST").length,
    "of them sent as POST,",
    "vendor_read",
    createTools(outbound).some((tool) => tool.name === "vendor_read")
      ? "offered"
      : "not offered"
  );
};

describe(instantly());

describe(smartlead());

describe(heyreach());

// The in-memory stand-in used by the other guides declares what a vendor
// declares, but it has no catalog, so it cannot stand in for native reads.
const standIn = createOutbound({ adapter: asVendor("heyreach", {}) });

console.log(
  `stand-in: native ${standIn.capabilities.native},`,
  Object.keys(standIn.native.catalog).length,
  "reads"
);
