import assert from "node:assert/strict";

import { createOutbound } from "outbound-sdk";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { seed } from "./seed.ts";
import { campaignSummary } from "./summary.ts";

// The same test once per vendor, on the in-memory adapter limited to what
// that vendor's adapter declares.
const testAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({ adapter: asVendor(vendor, seed) });
  const [founders] = await campaignSummary(outbound);

  assert.equal(founders?.sent, 200);

  // All three vendors say what a reply's category is, so each counts them.
  assert.equal(founders?.positiveReplies, 2);

  return `ok - ${vendor}: sent ${founders?.sent}, positive replies ${founders?.positiveReplies}`;
};

const lines = await Promise.all(VENDORS.map(testAs));

console.log(lines.join("\n"));
