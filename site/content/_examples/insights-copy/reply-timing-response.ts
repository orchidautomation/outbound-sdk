import { outbound } from "./outbound.ts";

const response = await outbound.insights.replyTiming({});

console.log(JSON.stringify(response, null, 2));
