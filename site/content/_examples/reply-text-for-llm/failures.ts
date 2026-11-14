import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { identity } from "outbound-sdk/identity";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

const masked = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [redact(), identity()],
});

const report = async (label: string, read: Promise<object>): Promise<void> => {
  try {
    await read;
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code}: ${error.message}`);
  }
};

// 1. Asking for text while it is being masked is refused before any request.
await report("bodies", masked.replies.list({ include: ["body"] }));

await report(
  "thread",
  masked.messages.list({ include: ["body"], leadId: "lead_dana" })
);

// 2. So is a vendor read: its payload is not normalized, so it cannot be masked.
const vendor = createOutbound({ adapter: heyreach(), plugins: [redact()] });

try {
  await vendor.native.read("checkApiKey");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`native: ${error.code}: ${error.message}`);
  }
}

console.log(
  "vendor_read offered:",
  createTools(vendor).some((tool) => tool.name === "vendor_read")
);

// 3. So is the raw client, which returns the same payload.
const rawRead = async () => ({
  body: await vendor.raw.get("/auth/CheckApiKey"),
});

await report("raw", rawRead());

// 4. A lookup by a person's address is refused too: the plugin that links
//    people would see masked records and could link nothing.
await report("person", masked.person("dana@example.com"));

console.log(
  "cross_channel_lead offered:",
  createTools(masked).some((tool) => tool.name === "cross_channel_lead")
);

// 5. Two plugins with one name are refused when the instance is created.
try {
  createOutbound({
    adapter: memory({ data: seed }),
    plugins: [redact(), redact({ strategy: "hash" })],
  });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`twice: ${error.code}: ${error.message}`);
  }
}
