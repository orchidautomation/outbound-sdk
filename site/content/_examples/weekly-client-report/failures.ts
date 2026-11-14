import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 1. An input the insight does not take is refused. It is never dropped,
//    which would quietly report on every campaign.
try {
  // @ts-expect-error -- `tag` is not an input of clientReport
  await outbound.insights.clientReport({ tag: "acme" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown input:", error.code, "-", error.message);
  }
}

// 2. A cap that stops a read early marks the answer incomplete and says why.
const capped = await outbound.insights.clientReport({
  max_campaigns: 2,
});

console.log("capped:", capped.meta.complete, capped.meta.notes);

// 3. Input outside its range is refused before any request.
try {
  await outbound.insights.clientReport({ days: 400 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad input:", error.code);
  }
}

// 4. An adapter that cannot read campaign stats refuses the whole insight.
const noStats = createOutbound({
  adapter: memory({ capabilities: { "stats.campaign": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noStats.insights.clientReport({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no stats:", error.code, "-", error.message);
  }
}
