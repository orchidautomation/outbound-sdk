import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { reconcile } from "outbound-sdk/reconcile";
import { memoryDedupeStore, parse, verify } from "outbound-sdk/webhooks";

import { payload, post, SECRET } from "./payloads.ts";
import { seed } from "./seed.ts";

const sent = payload("instantly", "email_sent");

// 1. A request without the secret. `verify` says no; `parse` throws.
console.log(
  "wrong secret, verify:",
  await verify(post(sent, "guess"), { provider: "instantly", secret: SECRET })
);

try {
  await parse(post(sent, "guess"), { provider: "instantly", secret: SECRET });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("wrong secret, parse:", error.code, "-", error.message);
  }
}

// 2. A provider with no parser.
try {
  await parse(post(sent), { provider: "mailchimp" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown provider:", error.code, "-", error.message);
  }
}

// 3. A body no parser recognises comes back as one `unknown` event with the
//    body in `raw`. It is not dropped and nothing throws.
const [unknown] = await parse(post(JSON.stringify({ hello: "world" })));

console.log("unrecognised body:", unknown?.type, JSON.stringify(unknown?.raw));

// 4. The id is claimed before your code runs. If your code then fails, the
//    vendor's retry is dropped as a repeat: the event is lost.
const dedupe = memoryDedupeStore();
const first = await parse(post(sent), { dedupe, provider: "instantly" });
const retry = await parse(post(sent), { dedupe, provider: "instantly" });

console.log(
  `claimed, then the handler crashed: first ${first.length}, retry ${retry.length}`
);

// 5. Reconcile compares every event it is given with the messages in the
//    window. An event from before the window is reported as unmatched.
const outbound = createOutbound({
  adapter: memory({ data: seed, name: "instantly", workspaceId: "acme" }),
  plugins: [reconcile()],
});

const narrow = await outbound.reconcile.events({
  events: first,
  since: "2026-11-14T01:00:00.000Z",
});

console.log(
  `window starts after the event: matched ${narrow.matched}, unmatched ${narrow.unmatchedEvents.length}`
);

// 6. An adapter that cannot list messages cannot be reconciled.
const noMessages = createOutbound({
  adapter: memory({ capabilities: { "messages.list": false }, data: seed }),
  plugins: [reconcile()],
});

try {
  await noMessages.reconcile.events({ events: first, since: "2026-11-14" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no message list:", error.code, "-", error.message);
  }
}
