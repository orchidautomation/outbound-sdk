import { readFileSync } from "node:fs";

import { createOutbound } from "outbound-sdk";
import type { WebhookRequest } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";

const adapter = combine([
  instantly({ workspaceId: "acme" }),
  heyreach({ workspaceId: "globex" }),
]);

const outbound = createOutbound({ adapter });

console.log("events.parse:", outbound.capabilities["events.parse"]);

console.log("events.verify:", outbound.capabilities["events.verify"]);

// Instantly's documented reply_received payload, from the repository's
// fixtures/instantly/ folder. It is not a delivery from Instantly.
const rawBody = readFileSync(
  new URL(
    "../../../../fixtures/instantly/webhook.reply_received.json",
    import.meta.url
  ),
  "utf-8"
);

const request: WebhookRequest = {
  body: JSON.parse(rawBody),
  headers: new Headers(),
  rawBody,
  url: "https://hooks.example.com/outbound",
};

// The member whose format matches parses it, under that member's label.
// The workspace argument is ignored on a combined adapter.
const events = adapter.events?.parse(request, "ignored") ?? [];

for (const event of events) {
  console.log(event.type, event.provider, event.workspaceId);
}

// The combined adapter has no signature check of its own.
console.log("verify:", adapter.events?.verify);
