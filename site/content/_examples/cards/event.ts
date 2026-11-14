import { eventCard, toSlackMessage } from "outbound-sdk/cards";
import { parse } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

// A reply webhook as Instantly documents it, sent to your endpoint.
const request = post(
  payload("instantly", "webhook.reply_received.json"),
  "https://your.app/hooks/example-shared-secret"
);

const events = await parse(request, {
  provider: "instantly",
  secret: "example-shared-secret",
});

for (const event of events) {
  // The reply's text was written by a prospect, so it is shown only when
  // asked for, as a quote.
  const message = toSlackMessage(eventCard(event, { includeText: true }));

  console.log(message.text);
  console.log(JSON.stringify(message.blocks, null, 2));
}
