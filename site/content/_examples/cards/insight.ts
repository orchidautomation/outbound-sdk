import { createOutbound } from "outbound-sdk";
import { cardFor, toSlackMessage } from "outbound-sdk/cards";
import { insights } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
  plugins: [insights()],
});

// An insight method's result goes to cardFor as it is.
const card = cardFor("hot_leads", await outbound.insights.hotLeads({}));

console.log(toSlackMessage(card, { style: "plain" }).text);
