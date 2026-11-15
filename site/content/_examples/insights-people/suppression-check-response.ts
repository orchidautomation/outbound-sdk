import { outbound } from "./outbound.ts";

const response = await outbound.insights.suppressionCheck({});

console.log(JSON.stringify(response, null, 2));
