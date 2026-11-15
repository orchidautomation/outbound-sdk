import { outbound } from "./outbound.ts";

const response = await outbound.insights.settingsAudit({});

console.log(JSON.stringify(response, null, 2));
