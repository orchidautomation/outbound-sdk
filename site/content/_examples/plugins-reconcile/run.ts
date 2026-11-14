import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { reconcile } from "outbound-sdk/reconcile";

import { seed } from "../plugins-index/seed.ts";
import { received } from "./received.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [reconcile()],
});

const report = await outbound.reconcile.events({
  events: received,
  since: "2026-11-09T00:00:00.000Z",
  until: "2026-11-14T00:00:00.000Z",
});

console.log("checked:", report.checked, "matched:", report.matched);

console.log("uncheckable:", report.uncheckable);

console.log(
  "webhook never arrived for:",
  report.missingEvents.map((message) => message.ref)
);

console.log(
  "event with no message:",
  report.unmatchedEvents.map((event) => `${event.id} (${event.messageRef})`)
);

console.log(
  "late:",
  report.late.map(
    ({ delayMs, event }) => `${event.id} by ${delayMs / 60_000} min`
  )
);

// The lead refs your database holds from an earlier sync.
const deletions = await outbound.reconcile.deletions({
  collection: "leads",
  known: [
    "memory:agency:lead_jane",
    "memory:agency:lead_sam",
    "memory:agency:lead_removed",
  ],
});

console.log("\nlisted by the vendor:", deletions.listed);

console.log("gone from the vendor:", deletions.deleted);

console.log("not in your copy yet:", deletions.added);
