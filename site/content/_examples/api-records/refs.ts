import {
  campaignSchema,
  createOutbound,
  makeRef,
  parseRef,
  SCHEMA_VERSION,
} from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const campaign = await outbound.campaigns.get("cmp_founders");

// The six fields every record carries.
console.log(campaign.provider, campaign.workspaceId, campaign.sourceId);

console.log(campaign.ref);

console.log(campaign.schemaVersion === SCHEMA_VERSION, campaign.raw);

// A ref is three parts joined with colons.
console.log(makeRef("instantly", "acme", "0193-ab"));

console.log(parseRef(campaign.ref));

console.log(parseRef("not-a-ref"));

// The ref and the vendor's own id name the same record.
const again = await outbound.campaigns.get(campaign.ref);

console.log(again.sourceId);

// The exported schemas check a record that came from somewhere else,
// for example your own database.
console.log(campaignSchema.safeParse(campaign).success);

console.log(campaignSchema.safeParse({ name: "No ref" }).success);
