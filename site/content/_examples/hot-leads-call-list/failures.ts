import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { CAMPAIGN, seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 1. max_leads stopped the read: the ranking covers the leads that were read.
const capped = await outbound.insights.hotLeads({ max_leads: 3 });

console.log(
  "capped:",
  capped.data.totals.leadsRead,
  capped.meta.complete,
  capped.meta.notes
);

// 2. `limit` only shortens the list. The answer is still complete.
const short = await outbound.insights.hotLeads({ limit: 1 });

console.log(
  "limit 1:",
  short.data.leads.length,
  "of",
  short.data.totals.hot,
  short.meta.complete
);

// 3. No lead has a label or a count: nobody is ranked, and nobody scores 0.
const empty = createOutbound({
  adapter: memory({
    data: {
      campaigns: [{ id: "c1" }],
      leads: [{ campaignId: "c1", email: "new@example.com", id: "l1" }],
    },
  }),
  plugins: [insights()],
});

const nothing = await empty.insights.hotLeads({});

console.log("no data:", nothing.data.leads.length, nothing.data.totals);

// 4. A negative weight is refused before any request.
try {
  await outbound.insights.hotLeads({ weight_open: -1 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad weight:", error.code);
  }
}

// 5. A tool that cannot list every lead needs a campaign.
const perCampaign = createOutbound({
  adapter: memory({
    capabilities: { "leads.list": false },
    data: seed,
    workspaceId: "acme",
  }),
  plugins: [insights()],
});

try {
  await perCampaign.insights.hotLeads({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no campaign:", error.code, "-", error.message);
  }
}

const scoped = await perCampaign.insights.hotLeads({ campaign: CAMPAIGN });

console.log("with a campaign:", scoped.data.totals.hot, "ranked");
