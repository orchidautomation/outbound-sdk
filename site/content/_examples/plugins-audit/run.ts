import { setImmediate } from "node:timers/promises";

import { createOutbound, OutboundError } from "outbound-sdk";
import { audit } from "outbound-sdk/audit";
import type { AuditEntry } from "outbound-sdk/audit";
import { budget } from "outbound-sdk/budget";
import { instantly } from "outbound-sdk/instantly";

import { documentedFetch } from "../plugins-budget/documented-fetch.ts";

const entries: AuditEntry[] = [];

// Instantly's adapter on a fetch that serves the vendor's documented
// payloads from disk, so there are real HTTP requests to record.
const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  fetch: documentedFetch,
  plugins: [
    audit({
      requests: true,
      sink: (entry) => {
        entries.push(entry);
      },
    }),
    // Inside the audit layer, so the call it stops is recorded as a failure.
    budget({ maxRequests: 1 }),
  ],
});

await outbound.senders.list();

try {
  await outbound.senders.listAll().toArray();
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }
}

// The sink is not awaited by the read. Give its entries a turn to arrive.
await setImmediate();

for (const entry of entries) {
  console.log(JSON.stringify(entry));
}
