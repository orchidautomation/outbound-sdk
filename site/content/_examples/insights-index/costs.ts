import { createOutbound, OutboundError } from "outbound-sdk";
import type { Json } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { insightCost, insights, INSIGHTS } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// Constructing a real adapter makes no request, and neither does pricing.
const VENDORS = {
  heyreach: createOutbound({ adapter: heyreach(), plugins: [insights()] }),
  instantly: createOutbound({ adapter: instantly(), plugins: [insights()] }),
  smartlead: createOutbound({ adapter: smartlead(), plugins: [insights()] }),
};

// The inputs an insight cannot run without; every other input is its default.
const REQUIRED = new Map<string, Json>([
  ["account_summary", { domain: "acme.example" }],
  ["campaign_diagnosis", { campaign: "cmp_founders" }],
  ["copy_audit", { campaign: "cmp_founders" }],
  ["copy_preview", { campaign: "cmp_founders" }],
  ["person_summary", { person: "person1@example.com" }],
  ["personalization_gaps", { campaign: "cmp_founders" }],
  ["pipeline_forecast", { campaign: "cmp_founders" }],
  ["step_funnel", { campaign: "cmp_founders" }],
  ["variant_test", { campaign: "cmp_founders" }],
]);

console.log(
  "insight: default cap at default inputs (heyreach, instantly, smartlead)"
);

for (const insight of INSIGHTS) {
  const caps = Object.values(VENDORS).map((outbound) => {
    const served = insight.needs.every(
      (need) => outbound.capabilities[need] !== false
    );

    return served
      ? String(
          insightCost(outbound, insight.name, REQUIRED.get(insight.name) ?? {})
            ?.defaultCap
        )
      : "-";
  });

  console.log(`${insight.name}: ${caps.join(", ")}`);
}

// A cap below the least the input can cost is refused before any request.
try {
  await VENDORS.smartlead.insights.clientReport({}, { maxRequests: 3 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`\n${error.code} (${error.limit}): ${error.message}`);
  }
}
