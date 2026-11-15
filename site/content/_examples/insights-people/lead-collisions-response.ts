import { outbound } from "./outbound.ts";

const response = await outbound.insights.leadCollisions({});

console.log(JSON.stringify(response, null, 2));
