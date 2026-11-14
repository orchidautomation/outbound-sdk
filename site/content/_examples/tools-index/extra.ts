import { createOutbound } from "outbound-sdk";
import { insightTools } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// Every insight the adapter can serve, as tools of the same shape.
const insights = insightTools(outbound);

console.log(`${insights.length} insight tools:`);

console.log(insights.map((tool) => tool.name).join(" "));

// `extra` appends them to the built-in set. `only` narrows each side.
const tools = createTools(outbound, {
  extra: insightTools(outbound, { only: ["client_report", "hot_leads"] }),
  only: ["campaign_overview"],
});

console.log(tools.map((tool) => tool.name));

const report = tools.find((tool) => tool.name === "client_report");
const result = await report?.call({ days: 7 });

if (result?.ok) {
  console.log(result.meta, Object.keys(result.data ?? {}));
}
