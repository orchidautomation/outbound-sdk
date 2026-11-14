import { createHmac } from "node:crypto";

import { OutboundError } from "outbound-sdk";
import { parse, verify } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

// A made-up signing secret in Smartlead's format: `whsec_` and base64 bytes.
const KEY = Buffer.from("example-signing-key-0001");
const SECRET = `whsec_${KEY.toString("base64")}`;
const body = payload("smartlead", "webhook.EMAIL_REPLY.json");
const options = { provider: "smartlead", secret: SECRET };

/** Signs a body the way the Standard Webhooks specification describes. */
const signed = (
  text: string,
  sentAt = Math.floor(Date.now() / 1000),
  id = "msg_example_0001"
): Request => {
  const signature = createHmac("sha256", KEY)
    .update(`${id}.${sentAt}.${text}`)
    .digest("base64");

  return post(text, undefined, {
    "webhook-id": id,
    "webhook-signature": `v1,${signature}`,
    "webhook-timestamp": String(sentAt),
  });
};

const [event] = await parse(signed(body), options);

console.log("signed:", event?.type, event?.id);

// The id comes from the `webhook-id` header, so a retry has the same one.
const [retry] = await parse(
  signed(body, Math.floor(Date.now() / 1000) + 30),
  options
);

console.log("same id on a retry:", event?.id === retry?.id);

const attempts = {
  "a body changed after signing": post(
    body.replace("EMAIL_REPLY", "EMAIL_SENT"),
    undefined,
    Object.fromEntries(signed(body).headers)
  ),
  "a timestamp six minutes old": signed(
    body,
    Math.floor(Date.now() / 1000) - 360
  ),
  "no signature headers": post(body),
  "the secret in the URL instead": post(
    body,
    `https://your.app/hooks/${SECRET}`
  ),
};

for (const [what, request] of Object.entries(attempts)) {
  // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps the output in order.
  console.log(`${what}:`, await verify(request, options));
}

try {
  await parse(post(body), options);
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message, `(${error.provider})`);
  }
}
