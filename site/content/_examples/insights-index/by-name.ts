import {
  insightTools,
  listInsights,
  runInsightByName,
} from "outbound-sdk/insights";
import { openaiTools } from "outbound-sdk/tools";

import { outbound } from "../insights-operations/outbound.ts";

// By tool name or by method name, with JSON input. This is what the CLI and
// an agent's tool call go through.
const result = await runInsightByName(outbound, "tag_rollup", {
  min_sent: 100,
});

console.log(result.insight, "complete:", result.meta.complete);

// What exists, without an instance: names, descriptions, needs, JSON Schema.
const listed = listInsights();
const entry = listed.find((insight) => insight.key === "bounceWatch");

console.log("insights:", listed.length);

console.log(entry?.name, "needs", entry?.needs);

// The insights this instance can serve, as agent tools.
const tools = insightTools(outbound, { only: ["hot_leads", "client_report"] });

console.log(
  "tools:",
  tools.map((tool) => tool.name)
);

// `only: []` leaves out the built-in tools, so the count is the insights alone.
const { tools: forOpenAi } = openaiTools(outbound, {
  extra: insightTools(outbound),
  only: [],
});

console.log("handed to the model:", forOpenAi.length);
