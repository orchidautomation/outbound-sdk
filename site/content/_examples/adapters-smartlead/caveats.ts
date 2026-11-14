import { createOutbound } from "outbound-sdk";
import { smartlead } from "outbound-sdk/smartlead";

const outbound = createOutbound({ adapter: smartlead() });

// What the adapter assumes and has not confirmed. No request is made.
for (const caveat of outbound.caveats) {
  console.log(`- ${caveat}\n`);
}
