import { createOutbound } from "outbound-sdk";
import type { Outbound, OutboundWith } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { insights } from "outbound-sdk/insights";
import type { InsightsExtension } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";

const plugins = [insights(), exporter()];

// The instance these plugins build, with what each one adds.
type Agency = OutboundWith<typeof plugins>;

const callFirst = async (outbound: Agency): Promise<string[]> => {
  const { data } = await outbound.insights.hotLeads({ limit: 3 });

  return data.leads.map((lead) => lead.name ?? lead.email ?? lead.lead);
};

// A function that needs one plugin can name that plugin's extension.
const waiting = async (
  outbound: Outbound & InsightsExtension
): Promise<number | null> => {
  const { data } = await outbound.insights.droppedReplies({});

  return data.totals.dropped;
};

const outbound = createOutbound({
  adapter: memory({ data: demoData() }),
  plugins,
});

console.log("call first:", await callFirst(outbound));

console.log("replies waiting:", await waiting(outbound));
