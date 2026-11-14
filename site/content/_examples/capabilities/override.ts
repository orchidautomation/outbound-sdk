import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const declared = createOutbound({ adapter: instantly() });

// A workspace on a plan without webhooks, with a key that cannot read tags.
const mine = createOutbound({
  adapter: instantly({
    capabilities: { tags: false, "webhooks.list": false },
  }),
});

for (const key of ["tags", "webhooks.list", "sequence"] as const) {
  console.log(key, declared.capabilities[key], "->", mine.capabilities[key]);
}
