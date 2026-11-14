import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

const outbound = createOutbound({ adapter: heyreach() });

// What the adapter assumes and has not confirmed. No request is made.
for (const caveat of outbound.caveats) {
  console.log(`- ${caveat}\n`);
}
