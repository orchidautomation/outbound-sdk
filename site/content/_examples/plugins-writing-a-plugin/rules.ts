import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { parse } from "outbound-sdk/webhooks";

import { seed } from "../plugins-index/seed.ts";

const describe = (error: OutboundError): string =>
  `${error.code} - ${error.message}`;

// Narrow, never widen. This plugin turns bodies off and tries to turn on
// something the adapter said it cannot do.
const noBodies: OutboundPlugin = {
  capabilities: (capabilities) => ({
    ...capabilities,
    "messages.body": false,
    "replies.category": "vendor",
  }),
  // Webhook events pass through `event`. Returning null drops one.
  event: (event) => (event.type === "unknown" ? null : event),
  name: "no-bodies",
};

const outbound = createOutbound({
  adapter: memory({
    capabilities: { "replies.category": false },
    data: seed,
  }),
  plugins: [noBodies],
});

console.log("messages.body:", outbound.capabilities["messages.body"]);

console.log("replies.category:", outbound.capabilities["replies.category"]);

// The SDK refuses the call before the plugin's wrap or the adapter runs,
// and the error names the plugin.
try {
  await outbound.messages.list({ include: ["body"] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("turned off:", describe(error));
  }
}

// A name the instance already has is an error when the instance is built.
const clash: OutboundPlugin<{ readonly campaigns: number }> = {
  extend: () => ({ campaigns: 1 }),
  name: "clash",
};

try {
  createOutbound({ adapter: memory(), plugins: [clash] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("name clash:", describe(error));
  }
}

// So is the same plugin name twice.
try {
  createOutbound({ adapter: memory(), plugins: [noBodies, noBodies] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("listed twice:", describe(error));
  }
}

// `event` runs when you hand the plugins to parse(). This payload matches
// no vendor, so it parses to one `unknown` event, which the plugin drops.
const request = new Request("https://example.com/hooks", {
  body: JSON.stringify({ hello: "world" }),
  method: "POST",
});

const kept = await parse(request.clone());
const filtered = await parse(request, { plugins: outbound.plugins });

console.log("events without the plugin:", kept.length);

console.log("events with it:", filtered.length);
