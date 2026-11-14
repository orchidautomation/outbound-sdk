import { OutboundError } from "outbound-sdk";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { openDatabase } from "./database.ts";
import { seed } from "./seed.ts";
import { syncAll, syncing } from "./sync-all.ts";

const syncAs = async (vendor: Vendor): Promise<string> => {
  const db = openDatabase();
  const outbound = syncing(asVendor(vendor, seed, "acme"), db);
  const { capabilities } = outbound;
  const filters = `leads.since ${capabilities["leads.since"]}, replies.since ${capabilities["replies.since"]}`;

  try {
    const results = await syncAll(outbound, db);
    const records = results.map((result) => result.records).join(" + ");

    return `${vendor}: ok, ${records} records (${filters})`;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    return `${vendor}: ${error.code}: ${error.message} (${filters})`;
  }
};

const lines = await Promise.all(VENDORS.map(syncAs));

console.log(lines.join("\n"));
