import { outbound } from "./outbound.ts";

const response = await outbound.insights.tagRollup({});

console.log(JSON.stringify(response, null, 2));
