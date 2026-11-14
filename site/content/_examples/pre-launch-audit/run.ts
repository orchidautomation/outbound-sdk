import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { preLaunchAudit } from "./audit.ts";
import { CAMPAIGN, seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

console.log(await preLaunchAudit(outbound, CAMPAIGN));
