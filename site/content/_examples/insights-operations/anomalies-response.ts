import { outbound } from "./outbound.ts";

const response = await outbound.insights.anomalies({});

console.log(JSON.stringify(response, null, 2));
