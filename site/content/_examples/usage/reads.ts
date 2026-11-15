import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// One page, with a cursor for the next.
const page = await outbound.campaigns.list({ limit: 1, status: "active" });

console.log(
  page.items.length,
  "campaign on this page; complete:",
  page.complete
);

// A handle is one record and everything under it.
const [first] = page.items;
const campaign = outbound.campaign(first?.ref ?? "");

const sequence = await campaign.sequence();

console.log("steps:", sequence.steps.length);

const stats = await campaign.stats({ from: "2026-11-01", to: "2026-11-30" });

console.log("sent:", stats.rows[0]?.sent);

for await (const lead of campaign.leads.listAll()) {
  console.log(lead.email, lead.status);
}

// Every result says how it was obtained.
console.log(stats.meta.evidence, stats.meta.provider, stats.meta.complete);
