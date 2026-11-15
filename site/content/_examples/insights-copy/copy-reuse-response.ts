import { outbound } from "./outbound.ts";

const response = await outbound.insights.copyReuse({});

console.log(JSON.stringify(response, null, 2));
