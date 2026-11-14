import { parse } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

// Instantly's documented "reply received" payload, posted to your endpoint.
const request = post(payload("instantly", "webhook.reply_received.json"));

const events = await parse(request, {
  provider: "instantly",
  workspaceId: "client-a",
});

for (const event of events) {
  // `raw` is the vendor's body, kept whole. Left out here to keep this short.
  console.log(
    JSON.stringify({ ...event, raw: "(the original body)" }, null, 2)
  );
}
