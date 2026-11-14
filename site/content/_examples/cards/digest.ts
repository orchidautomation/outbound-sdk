import { createOutbound } from "outbound-sdk";
import { digest, toSlackMessage } from "outbound-sdk/cards";
import { insights, insightTools } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
  plugins: [insights()],
});

const tools = insightTools(outbound, {
  only: ["domain_health", "hot_leads", "warmup_readiness"],
});

const sections = await Promise.all(
  tools.map(async (tool) => ({
    name: tool.name,
    result: await tool.call({}),
  }))
);

const message = toSlackMessage(
  digest({
    sections,
    subtitle: "Saturday 14 November",
    title: "Outbound this morning",
  })
);

// What each block says, one line per block.
for (const block of message.blocks) {
  console.log(
    JSON.stringify(block.text ?? block.fields ?? block.elements ?? block.type)
  );
}
