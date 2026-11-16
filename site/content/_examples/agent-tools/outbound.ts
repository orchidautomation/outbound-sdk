import { createOutbound } from "outbound-sdk";
import { identity } from "outbound-sdk/identity";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// Swap memory() for instantly(), smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  // The identity plugin adds outbound.person, which cross_channel_lead needs.
  plugins: [identity()],
});

// Three of the 27 insights, offered as tools beside the built-in ones.
export const extra = insightTools(outbound, {
  only: ["campaign_ranking", "hot_leads", "client_report"],
});
