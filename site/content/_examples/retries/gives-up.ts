import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "./fake-vendor.ts";
import type { Answer } from "./fake-vendor.ts";
import { instantClock } from "./instant-clock.ts";

const attempt = async (label: string, answer: Answer): Promise<void> => {
  const vendor = fakeVendor(answer);
  const delays: number[] = [];

  const outbound = createOutbound({
    adapter: instantly({ apiKey: "example-key" }),
    fetch: vendor.fetch,
    hooks: {
      onRetry: (event) => {
        delays.push(event.delayMs);
      },
    },
    runtime: instantClock(),
  });

  try {
    await outbound.raw.get("/campaigns");
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(
        `${label}: ${vendor.count()} request(s), ${error.code},`,
        `permanent ${error.permanent}, waits`,
        delays
      );
    }
  }
};

// Retried: the default is four retries after the first attempt.
await attempt("500", 500);

await attempt("503", 503);

await attempt("408", 408);

await attempt("no connection", "offline");

await attempt("429 with Retry-After: 20", {
  headers: { "retry-after": "20" },
  status: 429,
});

// Never retried.
await attempt("400", 400);

await attempt("401", 401);

await attempt("403", 403);

await attempt("404", 404);

await attempt("422", 422);
