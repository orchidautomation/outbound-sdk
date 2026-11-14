import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.personalizationGaps({
  campaign: "mailtool:acme:founders",
});

for (const variable of data.variables) {
  console.log(
    `${variable.name} (${variable.source}): steps [${variable.steps.join(", ")}], gap ${variable.gap}, leads affected ${variable.leadsAffected}`
  );
}

for (const lead of data.leads) {
  console.log(`${lead.email} is missing ${lead.missing.join(", ")}`);
}

console.log("unknown:", data.unknownVariables);

console.log("totals:", data.totals);
