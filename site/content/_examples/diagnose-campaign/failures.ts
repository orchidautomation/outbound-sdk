import { createOutbound, OutboundError } from "outbound-sdk";
import { benchmarks } from "outbound-sdk/benchmarks";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { CAMPAIGN, seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights(), benchmarks()],
});

// 1. A campaign that does not exist.
try {
  await outbound.insights.campaignDiagnosis({ campaign: "cmp_missing" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown campaign:", error.code, "-", error.message);
  }
}

// 2. Too few sends in the range to judge a rate. The reply and bounce
//    checks are skipped, and a finding says so.
const thin = await outbound.insights.campaignDiagnosis({
  campaign: CAMPAIGN,
  from: "2026-11-13",
});

console.log(
  "one day:",
  thin.data.findings.map((finding) => finding.code)
);

// 3. Daily counts that never vary are still tested. With no spread there is
//    no z-score, so a day is flagged only when its count differs at all.
const flat = await outbound.insights.anomalies({
  campaign: "cmp_founders",
  metrics: ["sent"],
});

console.log(
  "flat baseline:",
  flat.data.metrics[0]?.testable,
  "-",
  flat.data.anomalies.length,
  "unusual days"
);

// 4. A campaign the vendor returns no stats for cannot be benchmarked.
const empty = createOutbound({
  adapter: memory({ data: { campaigns: [{ id: "cmp_new" }] } }),
  plugins: [insights(), benchmarks()],
});

try {
  await empty.benchmarks.campaign("cmp_new");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no stats:", error.code, "-", error.message);
  }
}

// 5. The same campaign diagnosed: nothing to judge, and it says what it
//    could not check.
const blank = await empty.insights.campaignDiagnosis({ campaign: "cmp_new" });

console.log(
  "nothing reported:",
  blank.data.findings.map((finding) => finding.code),
  blank.data.notChecked
);

// 6. An adapter without campaign stats refuses the diagnosis.
const noStats = createOutbound({
  adapter: memory({ capabilities: { "stats.campaign": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noStats.insights.campaignDiagnosis({ campaign: CAMPAIGN });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no campaign stats:", error.code, "-", error.message);
  }
}
