import { createOutbound } from "outbound-sdk";
import { benchmarks } from "outbound-sdk/benchmarks";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { diagnose } from "./diagnose.ts";
import { CAMPAIGN, seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights(), benchmarks()],
});

console.log(await diagnose(outbound, CAMPAIGN));
