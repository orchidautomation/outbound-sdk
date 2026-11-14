import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.hotLeads({ limit: 3 });

for (const lead of data.leads) {
  console.log(`${lead.score} ${lead.email}: ${lead.reason}`);
  console.log("  parts:", lead.parts);
}

console.log("totals:", data.totals);
