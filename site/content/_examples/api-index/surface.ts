import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
  // Defaults for every call. Any call can set its own.
  deadline: 60_000,
  maxRequests: 200,
  retries: 4,
  timeout: 30_000,
});

// Properties. Reading them makes no request.
console.log(outbound.provider, outbound.workspaceId, outbound.maturity);

console.log("caveats:", outbound.caveats.length);

console.log("sequence:", outbound.capabilities.sequence);

// Collections, handles and stats.
const campaigns = await outbound.campaigns.list();
const sequence = await outbound.campaign("cmp_founders").sequence();
const stats = await outbound.stats({ from: "2026-10-01", to: "2026-10-31" });

console.log(
  campaigns.items.length,
  "campaigns,",
  sequence.steps.length,
  "steps,",
  stats.rows[0]?.sent,
  "sent"
);

// The same instance scoped to one workspace label.
console.log(outbound.workspace("acme") === outbound);

// `estimate` and `limits` read what the adapter declares. Neither sends a
// request, so this Instantly instance is never called.
const vendor = createOutbound({ adapter: instantly() });

console.log(vendor.estimate({ action: "leads.list", records: 2500 }));

console.log(vendor.estimate({ action: "leads.list" }));

const [limits] = await vendor.limits();

console.log(limits?.provider, "share", limits?.share);

for (const window of limits?.windows ?? []) {
  console.log(
    `${window.lane}: ${window.used} of ${window.requests} per ${window.perMs} ms`
  );
}
