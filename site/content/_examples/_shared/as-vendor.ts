// The in-memory adapter, limited to what one real vendor declares it can do.
// It proves which calls a vendor's adapter would refuse. It does not prove
// what that vendor's API returns.
import { resolveCapabilities } from "outbound-sdk";
import type { Adapter } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { memory } from "outbound-sdk/memory";
import type { MemoryData } from "outbound-sdk/memory";
import { smartlead } from "outbound-sdk/smartlead";

const DECLARED = {
  heyreach: () => heyreach({ apiKey: "not-used" }).capabilities,
  instantly: () => instantly({ apiKey: "not-used" }).capabilities,
  smartlead: () => smartlead({ apiKey: "not-used" }).capabilities,
};

export type Vendor = keyof typeof DECLARED;

export const VENDORS: readonly Vendor[] = [
  "instantly",
  "smartlead",
  "heyreach",
];

export const asVendor = (
  vendor: Vendor,
  data: MemoryData,
  workspaceId = "default"
): Adapter =>
  memory({
    // Resolved, so a capability the vendor's adapter leaves out is off.
    capabilities: resolveCapabilities(DECLARED[vendor]()),
    data,
    name: vendor,
    workspaceId,
  });
