import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { CAMPAIGN, seed } from "./seed.ts";
import { abVerdict } from "./verdict.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

console.log(await abVerdict(outbound, CAMPAIGN));
