import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "outbound-sdk";
import type { OutboundOptions } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";
import { instantClock } from "../retries/instant-clock.ts";

const attempt = async (
  label: string,
  options: Partial<OutboundOptions>
): Promise<void> => {
  // A stand-in vendor that answers 429 and asks for 60 seconds.
  const vendor = fakeVendor({ headers: { "retry-after": "60" }, status: 429 });

  const outbound = createOutbound({
    adapter: instantly({ apiKey: "example-key" }),
    fetch: vendor.fetch,
    // A budget of its own for each run, so one run does not slow the next.
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: instantClock(),
    ...options,
  });

  try {
    await outbound.raw.get("/campaigns");
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(`${label}: ${error.code} - ${error.message}`);
      console.log(
        `  limit ${error.limit}, permanent ${error.permanent}, requests ${vendor.count()}, timedOut ${error.timedOut}, retryAfterMs ${error.retryAfterMs}`
      );
    }
  }
};

// The wait the vendor asked for does not fit in the deadline.
await attempt("deadline", { deadline: 30_000 });

// The call may spend three requests. The fourth is never sent.
await attempt("maxRequestsPerCall", { maxRequestsPerCall: 3 });

// Neither is set: the SDK waits and retries four times, then gives up.
await attempt("retries used up", {});
