import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { reconcile } from "outbound-sdk/reconcile";

import { receive } from "./inbox.ts";
import { seed } from "./seed.ts";

const { received } = await receive();

// The in-memory adapter, carrying the provider name and workspace label the
// events carry, so a message's ref is the same on both sides.
const outbound = createOutbound({
  adapter: memory({ data: seed, name: "instantly", workspaceId: "acme" }),
  plugins: [reconcile()],
});

const report = await outbound.reconcile.events({
  events: received,
  since: "2026-11-14T00:00:00.000Z",
  until: "2026-11-14T12:00:00.000Z",
});

console.log(`compared ${report.checked} events, matched ${report.matched}`);

console.log(`not compared: ${report.uncheckable}`);

console.log(
  "listed by the vendor, no webhook:",
  report.missingEvents.map((message) => message.ref)
);

console.log(
  "webhook for a message the vendor does not list:",
  report.unmatchedEvents.map((event) => event.messageRef)
);

for (const { delayMs, event } of report.late) {
  console.log(`late: ${event.type} by ${Math.round(delayMs / 60_000)} minutes`);
}
