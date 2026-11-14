import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound, OutboundError } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { exportLeads, LEAD_COLUMNS } from "./export.ts";
import { seed } from "./seed.ts";

const dir = await mkdtemp(path.join(tmpdir(), "outbound-export-"));

const exportAs = async (vendor: Vendor): Promise<string> => {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [exporter()],
  });

  try {
    const result = await exportLeads(outbound, path.join(dir, `${vendor}.csv`));

    return `${vendor}: ok, ${result.rows} rows`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    // No list of every lead: export one campaign's leads at a time.
    const campaign = outbound.campaign("cmp_founders");

    const result = await outbound.export(campaign.leads.listAll(), {
      columns: LEAD_COLUMNS,
      to: path.join(dir, `${vendor}.cmp_founders.csv`),
    });

    return `${vendor}: ${error.code}: ${error.message}\n${vendor}: one campaign, ${result.rows} rows`;
  }
};

const lines = await Promise.all(VENDORS.map(exportAs));

console.log(lines.join("\n"));

await rm(dir, { recursive: true });
