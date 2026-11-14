import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { reconcile } from "outbound-sdk/reconcile";

import { seed } from "../plugins-index/seed.ts";
import { received } from "./received.ts";

// 1. An adapter that cannot list messages cannot check events.
const noMessages = createOutbound({
  adapter: memory({ capabilities: { "messages.list": false }, data: seed }),
  plugins: [reconcile()],
});

try {
  await noMessages.reconcile.events({
    events: received,
    since: "2026-11-09T00:00:00.000Z",
  });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no message list:", error.code, "-", error.message);
  }
}

// 2. Events passed without `receivedAt` are compared, but lateness is unknown.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [reconcile()],
});

const bare = await outbound.reconcile.events({
  events: received.map(({ event }) => event),
  since: "2026-11-09T00:00:00.000Z",
});

console.log(
  "without receivedAt:",
  bare.matched,
  "matched,",
  bare.late.length,
  "late"
);

// 3. A window that leaves out the days the events are about: every event
//    reads as unmatched. The report is only as good as the window.
const narrow = await outbound.reconcile.events({
  events: received,
  since: "2026-11-13T00:00:00.000Z",
});

console.log(
  "wrong window:",
  narrow.matched,
  "matched,",
  narrow.unmatchedEvents.length,
  "unmatched"
);
