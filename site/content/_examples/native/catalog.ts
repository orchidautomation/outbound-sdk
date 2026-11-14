import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

const outbound = createOutbound({ adapter: heyreach() });

// The catalog is data on the adapter. Reading it makes no request.
const { catalog } = outbound.native;
const names = Object.keys(catalog);

console.log(outbound.native.provider, "offers", names.length, "native reads");

console.log(names.slice(0, 6).join(", "), "...");

const read = catalog.campaignsForLead;

console.log(`\n${read.method} ${read.path}`);

console.log(read.description);

console.log(read.docs);

for (const [name, param] of Object.entries(read.params)) {
  console.log(
    `  ${name} (${param.type}, in ${param.in}): ${param.description}`
  );
}
