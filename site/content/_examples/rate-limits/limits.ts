import { createOutbound } from "outbound-sdk";
import type { OutboundApi } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// limits() makes no request: it reports the budget this process is keeping.
const instances: OutboundApi[] = [
  createOutbound({ adapter: instantly() }),
  createOutbound({ adapter: smartlead() }),
  createOutbound({ adapter: heyreach() }),
];

for (const outbound of instances) {
  const [snapshot] = await outbound.limits();

  console.log(`${outbound.provider} (share ${snapshot?.share})`);

  for (const window of snapshot?.windows ?? []) {
    console.log(
      `  ${window.lane}: ${window.requests} per ${window.perMs / 1000}s, used ${window.used}`
    );
  }
}
