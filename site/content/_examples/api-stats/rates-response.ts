import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({ adapter: memory({ data: seed }) });

const response = await outbound.campaign("cmp_launch").stats({
  from: "2026-11-09",
  to: "2026-11-10",
});

console.log(JSON.stringify(response, null, 2));
