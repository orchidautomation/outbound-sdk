import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { leadRunway } from "./runway.ts";
import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

console.log(await leadRunway(outbound, { warnDays: 5 }));
