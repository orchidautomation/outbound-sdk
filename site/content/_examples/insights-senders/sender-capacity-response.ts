import { outbound } from "./outbound.ts";

const response = await outbound.insights.senderCapacity({});

console.log(JSON.stringify(response, null, 2));
