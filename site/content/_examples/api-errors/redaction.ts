import {
  createOutbound,
  OutboundError,
  REDACTED_EMAIL,
  REDACTED_KEY,
  redactText,
} from "outbound-sdk";
import { smartlead } from "outbound-sdk/smartlead";

import { fakeVendor } from "../retries/fake-vendor.ts";

// Smartlead takes its key in the query string, so the key is in every URL.
const urls: string[] = [];

const outbound = createOutbound({
  adapter: smartlead({ apiKey: "example-key-1234" }),
  fetch: fakeVendor(401).fetch,
  hooks: {
    onRequest: (event) => {
      urls.push(event.url);
    },
  },
});

try {
  await outbound.raw.get("/campaigns");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

console.log(urls[0]);

// An error you build yourself is cleaned the same way.
const mine = new OutboundError(
  "Invalid",
  "No lead for jo@example.com with key example-key-1234",
  { secrets: ["example-key-1234"] }
);

console.log(mine.message);

// The same function, for your own logs.
console.log(redactText("reply from sam@example.com"));

console.log(REDACTED_KEY, REDACTED_EMAIL);
