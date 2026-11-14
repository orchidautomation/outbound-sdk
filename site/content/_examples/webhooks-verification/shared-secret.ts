import { OutboundError } from "outbound-sdk";
import { parse, verify } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

const SECRET = "example-shared-secret";
const body = payload("instantly", "webhook.reply_received.json");
const options = { provider: "instantly", secret: SECRET };

/** How many events `parse` returns for a request. */
const count = async (request: Request, secret?: string): Promise<number> => {
  const events = await parse(request, { provider: "instantly", secret });

  return events.length;
};

// Every place the secret is looked for.
const carrying = {
  "a path segment": post(body, `https://your.app/hooks/${SECRET}`),
  "?secret=": post(body, `https://your.app/hooks/outbound?secret=${SECRET}`),
  "?token=": post(body, `https://your.app/hooks/outbound?token=${SECRET}`),
  "?key=": post(body, `https://your.app/hooks/outbound?key=${SECRET}`),
  "x-webhook-secret": post(body, undefined, { "x-webhook-secret": SECRET }),
  "x-outbound-secret": post(body, undefined, { "x-outbound-secret": SECRET }),
  "Authorization: Bearer": post(body, undefined, {
    authorization: `Bearer ${SECRET}`,
  }),
};

for (const [where, request] of Object.entries(carrying)) {
  // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps the output in order.
  console.log(where.padEnd(22), await count(request, SECRET), "event");
}

// `verify` answers true or false and leaves the request readable.
const good = post(body, `https://your.app/hooks/${SECRET}`);

console.log("\nverify, secret present:", await verify(good, options));

console.log("then parse the same request:", await count(good, SECRET));

console.log("verify, secret missing:", await verify(post(body), options));

// `parse` throws when the check fails.
for (const request of [
  post(body),
  post(body, "https://your.app/hooks/wrong-secret"),
  post(body, undefined, { "x-webhook-secret": `${SECRET}x` }),
]) {
  try {
    // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps the output in order.
    await parse(request, options);
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(error.code, "-", error.message, `(${error.provider})`);
    }
  }
}

// No `secret` option: nothing is checked, and anyone's request is parsed.
console.log("\nno secret option:", await count(post(body)), "event");
