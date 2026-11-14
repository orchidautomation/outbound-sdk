import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { preLaunchAudit } from "./audit.ts";
import { CAMPAIGN, seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 1. A campaign that does not exist.
try {
  await preLaunchAudit(outbound, "cmp_missing");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown campaign:", error.code, "-", error.message);
  }
}

// 2. More leads than the cap. The counts cover the leads read, and the
//    answer says it is not complete.
const capped = await outbound.insights.personalizationGaps({
  campaign: CAMPAIGN,
  max_leads: 2,
});

console.log(
  "capped:",
  capped.meta.complete,
  `${capped.data.totals.leadsAffected} of ${capped.data.totals.leadsRead}`,
  capped.meta.notes
);

// 3. A status with no campaign in it. settingsAudit audits nothing and has
//    nothing to report, which is not the same as a clean campaign.
const paused = await outbound.insights.settingsAudit({ statuses: ["paused"] });

console.log("no campaign in that status:", paused.data.totals);

// 4. The default status is `active`, so a draft is not looked at unless asked.
const byDefault = await outbound.insights.settingsAudit({});

console.log(
  "default statuses:",
  byDefault.data.campaigns.map((campaign) => campaign.name)
);

// 5. An adapter that cannot read campaign settings refuses the settings
//    audit before any request.
const noSettings = createOutbound({
  adapter: memory({
    capabilities: { "campaigns.settings": false },
    data: seed,
  }),
  plugins: [insights()],
});

try {
  await noSettings.insights.settingsAudit({ statuses: ["draft"] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no settings:", error.code, "-", error.message);
  }
}
