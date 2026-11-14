// What an agent sees when the adapter cannot answer. This memory adapter
// declares no per-step stats and no reply categories, like a vendor that does
// not report them.
import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({
    capabilities: { "replies.category": false, "stats.byStep": false },
    data: seed,
  }),
});

const tools = createTools(outbound);

// Left out: a tool the adapter cannot serve is never offered.
console.log(tools.some((tool) => tool.name === "winning_steps"));

const replies = tools.find((tool) => tool.name === "reply_samples");

// Offered, then refused: the input asks for a read only it needs.
console.log(JSON.stringify(await replies?.call({ category: "positive" })));

// Input is strict: a filter the tool does not take is an error, not ignored.
console.log(JSON.stringify(await replies?.call({ campaign_name: "SaaS" })));
