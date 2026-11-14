import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// Real adapters, constructed and never called. `estimate` reads the costs an
// adapter declares and makes no request.
const vendors = [
  createOutbound({ adapter: instantly() }),
  createOutbound({ adapter: smartlead() }),
  createOutbound({ adapter: heyreach() }),
];

for (const outbound of vendors) {
  for (const leads of [500, 2000]) {
    const { basis, requests } = outbound.estimate({
      action: "leads.list",
      records: leads,
    });

    console.log(
      `${outbound.provider}: ${requests} requests to read ${leads} leads of one campaign (${basis})`
    );
  }
}
