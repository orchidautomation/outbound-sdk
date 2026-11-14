import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.settingsAudit({});

for (const campaign of data.campaigns) {
  console.log(`${campaign.name}:`);

  for (const finding of campaign.findings) {
    console.log(`  ${finding.severity} ${finding.check}: ${finding.finding}`);
  }
}

console.log("totals:", data.totals);
