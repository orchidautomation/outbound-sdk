import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData() }),
  hooks: {
    // Both of these fail on every call.
    onAction: () => {
      throw new Error("the metrics client is down");
    },
    onRequest: () => Promise.reject(new Error("the log pipe is closed")),
  },
});

const page = await outbound.campaigns.list();

console.log("the call still answered:", page.items.length, "campaigns");
