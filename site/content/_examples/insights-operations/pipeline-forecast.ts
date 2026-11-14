import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.pipelineForecast({
  campaign: "memory:acme:founders",
});

console.log(data.finding);

console.log("by status:", data.byStatus);

console.log(
  `${data.remaining} leads at ${data.dailyContactRate} a day: ${data.daysLeft} days left`
);

console.log("expected positive replies:", data.expectedPositive);

console.log(data.assumptions.at(-1));
