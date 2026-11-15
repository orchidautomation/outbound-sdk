import { outbound } from "./outbound.ts";

const response = await outbound.insights.hotLeads({ limit: 3 });

console.log(JSON.stringify(response, null, 2));
