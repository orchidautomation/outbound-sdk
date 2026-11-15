import { outbound } from "./outbound.ts";

const response = await outbound.insights.personalizationGaps({
  campaign: "mailtool:acme:founders",
});

console.log(JSON.stringify(response, null, 2));
