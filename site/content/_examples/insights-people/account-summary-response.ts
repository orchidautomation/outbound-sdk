import { outbound } from "./outbound.ts";

const response = await outbound.insights.accountSummary({
  domain: "northwind.example.com",
});

console.log(JSON.stringify(response, null, 2));
