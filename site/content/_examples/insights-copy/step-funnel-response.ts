import { outbound } from "./outbound.ts";

const response = await outbound.insights.stepFunnel({
  campaign: "memory:acme:founders",
  min_reply_rate: 0.01,
});

console.log(JSON.stringify(response, null, 2));
