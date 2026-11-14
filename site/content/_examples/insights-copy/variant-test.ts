import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.variantTest({
  campaign: "memory:acme:founders",
});

for (const step of data.steps) {
  console.log(`step ${step.step}: ${step.verdict}, p-value ${step.pValue}`);
  console.log(`  ${step.reason}`);
  console.log("  more sends needed:", step.moreSendsNeeded);
}

console.log("totals:", data.totals);
