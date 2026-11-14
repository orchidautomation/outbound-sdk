import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { seed } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [insights()],
  });

  try {
    // oxlint-disable-next-line no-await-in-loop -- one vendor at a time.
    const { data, meta } = await outbound.insights.droppedReplies({});

    console.log(
      `${vendor}: ok, ${data.totals.dropped} unanswered, checked by ${[...new Set(data.dropped.map((reply) => reply.checkedBy))].join(" and ")}`
    );

    for (const note of meta.notes) {
      console.log(`  note: ${note}`);
    }
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${vendor}: ${error.code}: ${error.message}`);
  }
}
