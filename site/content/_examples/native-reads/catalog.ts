import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

// Reads HEYREACH_API_KEY. Reading the catalog makes no request.
const outbound = createOutbound({ adapter: heyreach() });
const { catalog } = outbound.native;

console.log(outbound.native.provider, "native:", outbound.capabilities.native);

console.log(Object.keys(catalog).length, "reads:");

console.log(Object.keys(catalog).join(", "));

// One entry: what it answers, the vendor's method and path, each parameter
// and where it goes, and the vendor's documentation page.
console.log(catalog.campaignsForLead);
