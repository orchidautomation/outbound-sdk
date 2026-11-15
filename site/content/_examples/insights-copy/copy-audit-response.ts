import { outbound } from "./outbound.ts";

const response = await outbound.insights.copyAudit({
  campaign: "memory:acme:founders",
});

console.log(JSON.stringify(response, null, 2));
