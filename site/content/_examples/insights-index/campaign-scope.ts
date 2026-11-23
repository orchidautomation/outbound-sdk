import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import type { InsightInputs } from "outbound-sdk/insights";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "agency" }),
  plugins: [insights()],
});

type Scope = Pick<
  InsightInputs["campaignRanking"],
  "campaign_ids" | "campaign_name" | "tag"
>;

const show = async (label: string, scope: Scope): Promise<void> => {
  const answer = await outbound.insights.campaignRanking({
    statuses: ["active", "paused", "completed"],
    ...scope,
  });

  const { ranked, tooFewSends, unknown } = answer.data;

  const names = [...ranked, ...tooFewSends, ...unknown].map(
    (each) => each.campaignName
  );

  console.log(`${label}: ${names.join(", ") || "none"}`);
  console.log(`  ${answer.meta.notes.join(" ")}`);
};

// One client's campaigns, by the tag they carry.
await show("tag", { tag: "client-a" });

// By name: an exact name, a glob with * and ?, or /regex/flags.
await show("name", { campaign_name: "agency*" });

// By id, read one by one with no listing. With a tag or a name as well, a
// campaign must match every part given.
await show("ids and tag", {
  campaign_ids: ["memory:agency:cmp_founders", "cmp_agencies"],
  tag: "client-b",
});

// A tag where campaigns carry none is refused before any request.
const tagless = createOutbound({
  adapter: memory({
    capabilities: { "campaigns.byTag": false },
    data: demoData(),
  }),
  plugins: [insights()],
});

try {
  await tagless.insights.campaignRanking({ tag: "client-a" });
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`tagless: ${error.code}: ${error.message}`);
}
