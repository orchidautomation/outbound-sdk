import { outbound } from "./outbound.ts";

const response = await outbound.insights.bounceWatch({});

console.log(JSON.stringify(response, null, 2));
