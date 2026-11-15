import { outbound } from "./outbound.ts";

const response = await outbound.insights.senderLoad({
  max_campaigns_per_sender: 2,
});

console.log(JSON.stringify(response, null, 2));
