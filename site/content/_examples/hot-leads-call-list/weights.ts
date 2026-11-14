import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// The weights are inputs. Here a recent reply matters most, opens count for
// nothing, and the vendor's "Not Interested" label is left as it is.
const { data } = await outbound.insights.hotLeads({
  recency_days: 7,
  weight_interest: 10,
  weight_open: 0,
  weight_recency: 60,
});

for (const lead of data.leads) {
  console.log(String(lead.score).padStart(6), lead.email);
}
