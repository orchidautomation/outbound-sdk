import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { outbound } from "./agency.ts";
import { emailTool } from "./seed.ts";

// 1. A cap stopped a campaign's leads early. A collision can hide in the
//    leads that were not read, so the answer says it is incomplete.
const capped = await outbound.insights.leadCollisions({
  max_leads_per_campaign: 2,
});

console.log(
  "capped:",
  capped.data.totals.leadsRead,
  capped.data.totals.collisions,
  capped.meta.complete,
  capped.meta.notes
);

// 2. The same person under an address in one tool and a profile in the
//    other, with no record that holds both: not matched, and not an error.
const apart = createOutbound({
  adapter: memory({
    data: {
      campaigns: [{ id: "c1" }, { channel: "linkedin", id: "c2" }],
      leads: [
        { campaignId: "c1", email: "ida@example.com", id: "l1" },
        {
          campaignId: "c2",
          firstName: "Ida",
          id: "l2",
          linkedinUrl: "https://www.linkedin.com/in/ida-example",
        },
        // A lead with neither cannot be matched to anyone.
        { campaignId: "c2", firstName: "Ida", id: "l3" },
      ],
    },
  }),
  plugins: [insights()],
});

const unmatched = await apart.insights.leadCollisions({});

console.log("no shared identifier:", unmatched.data.totals);

// 3. An empty status list is refused before any request.
try {
  await outbound.insights.suppressionCheck({ statuses: [] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad input:", error.code);
  }
}

// 4. An adapter with no block list refuses suppressionCheck, and only that.
const noBlockList = createOutbound({
  adapter: memory({ capabilities: { blocklist: false }, data: emailTool }),
  plugins: [insights()],
});

try {
  await noBlockList.insights.suppressionCheck({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no block list:", error.code, "-", error.message);
  }
}

const stillRuns = await noBlockList.insights.leadCollisions({});

console.log("collisions still run:", stillRuns.data.totals.collisions);
