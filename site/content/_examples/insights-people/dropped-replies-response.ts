import { outbound } from "./outbound.ts";

const response = await outbound.insights.droppedReplies({});

console.log(JSON.stringify(response, null, 2));
