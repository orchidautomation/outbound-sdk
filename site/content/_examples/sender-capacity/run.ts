import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { capacityFor } from "./plan.ts";
import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// Can the senders carry a new campaign of 40 sends a day?
console.log(await capacityFor(outbound, 40));
