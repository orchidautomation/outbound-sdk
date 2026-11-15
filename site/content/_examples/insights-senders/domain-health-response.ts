import { outbound } from "./outbound.ts";

const response = await outbound.insights.domainHealth({});

console.log(JSON.stringify(response, null, 2));
