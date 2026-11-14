import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Or pass it: instantly({ apiKey }).
const outbound = createOutbound({ adapter: instantly() });

console.log(outbound.provider, outbound.maturity);

console.log(outbound.capabilities["replies.category"]);
