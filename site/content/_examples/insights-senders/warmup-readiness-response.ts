import { outbound } from "./outbound.ts";

const response = await outbound.insights.warmupReadiness({
  check_health: true,
});

console.log(JSON.stringify(response, null, 2));
