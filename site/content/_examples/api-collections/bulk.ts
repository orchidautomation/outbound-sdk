import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

const campaign = await outbound.campaigns.get("cmp_founders");

console.log(campaign.name, campaign.meta.evidence);

console.log(await outbound.campaigns.exists("cmp_founders"));

console.log(await outbound.campaigns.exists("cmp_gone"));

// A missing record does not fail the batch. It is listed under `errors`.
const { errors, results } = await outbound.campaigns.getMany(
  ["cmp_agencies", "cmp_gone", "cmp_founders"],
  { concurrency: 2 }
);

for (const { id, value } of results) {
  console.log("ok:", id, value.name);
}

for (const { error, id } of errors) {
  console.log("failed:", id, error.code, "-", error.message);
}
