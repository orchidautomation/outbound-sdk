import { createOutbound, OutboundError } from "outbound-sdk";
import { insights, insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { outbound } from "../insights-operations/outbound.ts";
import { seed } from "../insights-operations/seed.ts";

const report = async <Answer>(
  label: string,
  run: () => Promise<Answer>
): Promise<void> => {
  try {
    await run();
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code}: ${error.message}`);
  }
};

// 1. A key the insight does not take. The types refuse it, and so does the
//    call: dropping it would quietly rank every campaign.
await report("unknown key", () =>
  // @ts-expect-error -- `label` is not an input of campaignRanking
  outbound.insights.campaignRanking({ label: "saas" })
);

// 2. A value of the wrong type.
await report("wrong type", () =>
  // @ts-expect-error -- `min_sent` is a number
  outbound.insights.campaignRanking({ min_sent: "fifty" })
);

// 3. A value outside its range.
await report("out of range", () =>
  outbound.insights.campaignRanking({ max_campaigns: 500 })
);

// 4. A required input left out.
await report("missing", () =>
  // @ts-expect-error -- `campaign` is required
  outbound.insights.pipelineForecast({})
);

// 5. An adapter that cannot read campaign stats. Refused before any request,
//    and left out of the tool list.
const noStats = createOutbound({
  adapter: memory({ capabilities: { "stats.campaign": false }, data: seed }),
  plugins: [insights()],
});

await report("no capability", () => noStats.insights.campaignRanking({}));

const offered = insightTools(noStats).map((tool) => tool.name);

console.log(
  `tools offered: ${offered.length}, campaign_ranking among them: ${offered.includes("campaign_ranking")}`
);
