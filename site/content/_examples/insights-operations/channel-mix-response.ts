import { outbound } from "./outbound.ts";

const response = await outbound.insights.channelMix({});

console.log(JSON.stringify(response, null, 2));
