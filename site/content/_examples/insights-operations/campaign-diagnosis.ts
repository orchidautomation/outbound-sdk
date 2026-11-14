import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.campaignDiagnosis({
  campaign: "memory:acme:ecom",
});

console.log(data.summary);

for (const finding of data.findings) {
  console.log(`${finding.severity} ${finding.code}: ${finding.finding}`);
}

console.log("not checked:", data.notChecked);
