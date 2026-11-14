import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 1. More leads than the cap. The count of leads left is a minimum, and the
//    finding says "at least".
const capped = await outbound.insights.pipelineForecast({
  campaign: "cmp_agencies",
  max_leads: 100,
});

console.log(
  "capped:",
  capped.data.leadsComplete,
  capped.meta.complete,
  "-",
  capped.data.finding
);

// 2. A campaign with no sends yet. There is no pace to divide by and no
//    reply rate to project, so both are null. Neither is 0.
const fresh = await outbound.insights.pipelineForecast({ campaign: "cmp_new" });

console.log(
  "nothing sent:",
  fresh.data.daysLeft,
  fresh.data.expectedReplies.expected,
  "-",
  fresh.data.finding
);

// 3. An adapter without stats by day. Leads are still counted; days left
//    are not estimated, and a note says so.
const noDaily = createOutbound({
  adapter: memory({ capabilities: { "stats.byDay": false }, data: seed }),
  plugins: [insights()],
});

const undated = await noDaily.insights.pipelineForecast({
  campaign: "cmp_founders",
});

console.log(
  "no daily stats:",
  undated.data.remaining,
  undated.data.daysLeft,
  undated.meta.notes
);

// 4. A campaign that does not exist.
try {
  await outbound.insights.pipelineForecast({ campaign: "cmp_missing" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown campaign:", error.code, "-", error.message);
  }
}

// 5. An adapter that cannot list a campaign's leads refuses the forecast.
const noLeads = createOutbound({
  adapter: memory({ capabilities: { "leads.byCampaign": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noLeads.insights.pipelineForecast({ campaign: "cmp_founders" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no leads:", error.code, "-", error.message);
  }
}
