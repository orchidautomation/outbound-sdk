import { outbound } from "./outbound.ts";

const response = await outbound.insights.personSummary({
  person: "ana@northwind.example.com",
});

console.log(JSON.stringify(response, null, 2));
