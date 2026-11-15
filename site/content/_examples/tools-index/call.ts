import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const tools = new Map(createTools(outbound).map((tool) => [tool.name, tool]));

// `call` takes the model's arguments as JSON and returns a result object.
const overview = await tools.get("campaign_overview")?.call({});

console.log(JSON.stringify(overview, null, 2));

const trend = await tools.get("campaign_trend")?.call({
  campaign: "cmp_founders",
  from: "2026-11-01",
  to: "2026-11-30",
});

console.log(JSON.stringify(trend, null, 2));
