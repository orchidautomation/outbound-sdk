import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { memory } from "outbound-sdk/memory";
import { smartlead } from "outbound-sdk/smartlead";

// Real adapters, built to read the costs they declare. `estimate` is
// arithmetic on those declarations and makes no request.
const ADAPTERS = [instantly(), smartlead(), heyreach(), memory()];

for (const adapter of ADAPTERS) {
  const outbound = createOutbound({ adapter });

  console.log(outbound.provider);

  for (const action of ["campaigns.list", "leads.list", "replies.list"]) {
    const { basis, requests } = outbound.estimate({ action, records: 1000 });

    console.log(`  ${action}, 1000 records: ${requests} (${basis})`);
  }
}
