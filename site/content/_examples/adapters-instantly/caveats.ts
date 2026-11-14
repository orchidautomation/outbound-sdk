import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const outbound = createOutbound({ adapter: instantly() });

// What the adapter assumes and has not confirmed. No request is made.
for (const caveat of outbound.caveats) {
  console.log(`- ${caveat}\n`);
}
