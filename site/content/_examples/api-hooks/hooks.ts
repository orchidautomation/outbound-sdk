import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";
import { instantClock } from "../retries/instant-clock.ts";

// A stand-in vendor: an empty 200, a 503, an empty 200, then 401 for good.
const vendor = fakeVendor(200, 503, 200, 401);

const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: vendor.fetch,
  hooks: {
    onAction: (event) => {
      console.log("onAction", event);
    },
    onError: (event) => {
      console.log("onError", {
        action: event.action,
        error: event.error.message,
        provider: event.provider,
        workspaceId: event.workspaceId,
      });
    },
    onRequest: (event) => {
      console.log("onRequest", event);
    },
    onRetry: (event) => {
      console.log("onRetry", event);
    },
    onThrottle: (event) => {
      console.log("onThrottle", event);
    },
  },
  runtime: instantClock(),
  // One percent of Instantly's limit is one request a second, so the second
  // request has to wait.
  share: 0.01,
});

console.log("-- a call that succeeds");

await outbound.raw.get("/campaigns");

console.log("-- a call that is throttled, fails once and is retried");

await outbound.raw.get("/campaigns");

console.log("-- a call that fails");

try {
  await outbound.raw.get("/campaigns");
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }
}
