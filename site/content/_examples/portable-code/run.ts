import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { campaignBrief } from "./portable.ts";
import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

const lines = await campaignBrief(outbound, "cmp_founders");

console.log(lines.join("\n"));
