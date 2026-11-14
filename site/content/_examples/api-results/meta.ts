import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), pageSize: 2, workspaceId: "acme" }),
});

// A page: `meta` sits beside `items`.
const page = await outbound.leads.list();

console.log(page.meta);

console.log(
  "items:",
  page.items.length,
  "| cursor:",
  page.cursor !== undefined
);

// One record: `meta` is a field on the record itself.
const campaign = await outbound.campaigns.get("cmp_founders");

console.log(campaign.name, campaign.meta.evidence, campaign.meta.complete);

// Stats: `meta` sits beside `rows`.
const stats = await outbound.stats();

console.log(stats.rows.length, stats.meta.evidence, stats.meta.complete);

// A walk: the meta of the last page fetched.
const walk = outbound.leads.listAll();

console.log("before the first page:", walk.meta);

await walk.toArray();

console.log("after the last page:", walk.meta?.complete);
