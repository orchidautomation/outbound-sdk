import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";
import { memory } from "outbound-sdk/memory";
import { smartlead } from "outbound-sdk/smartlead";

import { VENDORS } from "../_shared/as-vendor.ts";
import { DOMAIN, emailTool } from "./seed.ts";

// What each vendor's adapter can do once an instance has resolved it: a
// capability the adapter leaves out is `false` here. This guide turns on
// `leads.engagement`, which Smartlead's adapter leaves out.
const DECLARED = {
  heyreach: () =>
    createOutbound({ adapter: heyreach({ apiKey: "not-used" }) }).capabilities,
  instantly: () =>
    createOutbound({ adapter: instantly({ apiKey: "not-used" }) }).capabilities,
  smartlead: () =>
    createOutbound({ adapter: smartlead({ apiKey: "not-used" }) }).capabilities,
};

// Counts are not printed here: the in-memory data has counts a real vendor
// may not report. Only what is refused, and what is noted, carries over.
for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: DECLARED[vendor](),
      data: emailTool,
      name: vendor,
      workspaceId: "agency",
    }),
    plugins: [insights()],
  });

  try {
    // oxlint-disable-next-line no-await-in-loop -- one vendor at a time.
    const { meta } = await outbound.insights.accountSummary({
      domain: DOMAIN,
    });

    console.log(
      `${vendor}: ok, leads read ${outbound.capabilities["leads.list"] ? "from one list" : "campaign by campaign"}`
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
