import { setImmediate } from "node:timers/promises";

import { createOutbound } from "outbound-sdk";
import { audit } from "outbound-sdk/audit";
import { budget } from "outbound-sdk/budget";
import { cache } from "outbound-sdk/cache";
import { clients } from "outbound-sdk/clients";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "./seed.ts";

const audited: string[] = [];

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    // Outermost: masks whatever the layers inside it return.
    redact(),
    // Tags records.
    clients({ rules: [{ campaignTag: "acme", client: "Acme" }] }),
    // A repeat read stops here and skips everything below.
    cache({ ttl: 60 }),
    // So this records only the reads that did real work.
    audit({
      sink: (entry) => {
        audited.push(entry.type === "call" ? entry.operation : entry.type);
      },
    }),
    // Innermost: next to the request engine.
    budget({ maxRequests: 50 }),
  ],
});

const first = await outbound.lead("lead_jane").get();
const second = await outbound.lead("lead_jane").get();

// The address is a token keyed for this run; the same lead gets the same one.
console.log("same token:", first.email === second.email);

for (const lead of [first, second]) {
  console.log(
    `email ${lead.email?.slice(0, 9)}…, client ${"client" in lead ? lead.client : "?"}`
  );
}

// The audit sink is not awaited by the read. Give its entries a turn to arrive.
await setImmediate();

console.log("audited:", audited);
