import { outbound } from "./outbound.ts";

const response = await outbound.insights.campaignRanking({});

console.log(JSON.stringify(response, null, 2));
