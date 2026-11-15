import { outbound } from "./outbound.ts";

const response = await outbound.insights.periodComparison({});

console.log(JSON.stringify(response, null, 2));
