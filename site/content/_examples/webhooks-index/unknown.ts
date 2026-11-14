import { OutboundError } from "outbound-sdk";
import { parse } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

const show = async (label: string, request: Request, provider?: string) => {
  const events = await parse(request, { provider });
  console.log(
    label,
    events.map((event) => ({
      provider: event.provider,
      raw: event.raw === null ? null : "(kept)",
      type: event.type,
      vendorEvent: event.data.vendorEvent,
    }))
  );
};

const reply = payload("instantly", "webhook.reply_received.json");

// `auto` (the default) detects the vendor from the payload.
await show("auto:", post(reply));

// A body no parser recognises is still returned, as one unknown event.
await show("unrecognised:", post(JSON.stringify({ hello: "world" })));

// A vendor event with no normalized type keeps its vendor name and its body.
await show(
  "no normalized type:",
  post(payload("smartlead", "webhook.MANUAL_STEP_REACHED.json")),
  "smartlead"
);

// A provider with no parser is an error, not an unknown event.
try {
  await parse(post(reply), { provider: "mailchimp" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}
