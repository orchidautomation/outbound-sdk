import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";
import type { OutboundTool } from "outbound-sdk/tools";

const find = (tools: readonly OutboundTool[], name: string) =>
  tools.find((tool) => tool.name === name);

const tools = createTools(
  createOutbound({ adapter: memory({ data: demoData() }) })
);

const show = async (
  label: string,
  tool: OutboundTool | undefined,
  input: Parameters<OutboundTool["call"]>[0]
) => {
  console.log(
    `${label}\n${JSON.stringify(await tool?.call(input), null, 2)}\n`
  );
};

await show(
  "An argument the tool does not take",
  find(tools, "campaign_overview"),
  {
    client: "acme",
  }
);

await show("A value of the wrong shape", find(tools, "campaign_trend"), {
  campaign: "cmp_founders",
  from: "yesterday",
  to: "2026-10-31",
});

await show("A record that does not exist", find(tools, "campaign_setup"), {
  campaign: "no-such-campaign",
});

// An adapter that, like HeyReach, reports no reply categories. reply_samples
// is still offered, because it works without the filter.
const limited = createTools(
  createOutbound({
    adapter: memory({
      capabilities: { "replies.category": false },
      data: demoData(),
    }),
  })
);

await show("A read the adapter cannot serve", find(limited, "reply_samples"), {
  category: "positive",
});
