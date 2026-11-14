import { createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { demoData, memory } from "outbound-sdk/memory";

// Two clients behind one instance. Both have a campaign with the same id.
const outbound = createOutbound({
  adapter: combine([
    memory({ data: demoData(), workspaceId: "acme" }),
    memory({ data: demoData(), workspaceId: "globex" }),
  ]),
});

try {
  await outbound.campaigns.get("cmp_founders");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

// Use the ref a record carries.
const { items } = await outbound.campaigns.list();

console.log(items.map((campaign) => campaign.ref));

const [first] = items;
const campaign = await outbound.campaigns.get(first?.ref ?? "");

console.log(campaign.name, "from", campaign.workspaceId);

// Or scope to one workspace, where a bare id is enough.
const globex = await outbound.workspace("globex").campaigns.get("cmp_founders");

console.log(globex.ref);

try {
  outbound.workspace("initech");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}
