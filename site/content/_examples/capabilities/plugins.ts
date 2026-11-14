import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

// A plugin's `capabilities` hook returns the map to advertise.
const noBodies: OutboundPlugin = {
  capabilities: (capabilities) => ({ ...capabilities, "messages.body": false }),
  name: "no-bodies",
};

// This one tries to add what the adapter never declared.
const wishful: OutboundPlugin = {
  capabilities: (capabilities) => ({ ...capabilities, "senders.health": true }),
  name: "wishful",
};

const outbound = createOutbound({
  adapter: memory({
    capabilities: { "senders.health": false },
    data: demoData(),
  }),
  plugins: [noBodies, wishful],
});

console.log("messages.body:", outbound.capabilities["messages.body"]);

console.log("senders.health:", outbound.capabilities["senders.health"]);

try {
  await outbound.replies.list({ include: ["body"] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.message);
  }
}
