import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// Constructing an adapter makes no request.
const adapters = {
  heyreach: createOutbound({ adapter: heyreach() }).capabilities,
  instantly: createOutbound({ adapter: instantly() }).capabilities,
  smartlead: createOutbound({ adapter: smartlead() }).capabilities,
};

for (const [provider, capabilities] of Object.entries(adapters)) {
  console.log(provider.padEnd(10), capabilities["events.verify"]);
}
