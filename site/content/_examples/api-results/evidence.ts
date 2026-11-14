import { createOutbound } from "outbound-sdk";
import type { ResultMeta } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

// This adapter cannot filter leads by date, so the SDK filters each page
// after fetching it.
const outbound = createOutbound({
  adapter: memory({
    capabilities: { "leads.since": "client" },
    data: demoData(),
  }),
});

// Decide once what an answer has to be before you act on it.
const trusted = (meta: ResultMeta): boolean =>
  meta.evidence === "exact" && meta.complete && !meta.stale;

const all = await outbound.leads.list();

console.log(all.items.length, all.meta.evidence, trusted(all.meta));

const recent = await outbound.leads.list({ since: "2026-10-03" });

console.log(recent.items.length, recent.meta.evidence, trusted(recent.meta));
