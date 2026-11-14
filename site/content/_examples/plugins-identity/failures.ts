import { createOutbound, OutboundError } from "outbound-sdk";
import { identity } from "outbound-sdk/identity";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [identity()],
});

// 1. A name is not an exact identifier, so it is refused.
try {
  await outbound.person("Jane Doe");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("a name:", error.code, "-", error.message);
  }
}

// 2. Bounded to one campaign, and without the timeline.
const bounded = await outbound.person("email:priya.patel@example.com", {
  campaignIds: ["memory:agency:cmp_founders"],
  timeline: false,
});

console.log("wrong campaign:", bounded.found);

// 3. An adapter that cannot read a lead's timeline: the records still link.
const noTimeline = createOutbound({
  adapter: memory({
    capabilities: { "leads.timeline": false },
    data: seed,
    workspaceId: "agency",
  }),
  plugins: [identity()],
});

const jane = await noTimeline.person("jane.doe@example.com");

console.log("no timeline:", jane.records.length, jane.timeline.length);
