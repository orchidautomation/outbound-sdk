import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundOptions } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "./fake-vendor.ts";
import type { Answer } from "./fake-vendor.ts";
import { instantClock } from "./instant-clock.ts";

const attempt = async (
  label: string,
  answer: Answer,
  options: Partial<OutboundOptions>
): Promise<void> => {
  const vendor = fakeVendor(answer);

  const outbound = createOutbound({
    adapter: instantly({ apiKey: "example-key" }),
    fetch: vendor.fetch,
    runtime: instantClock(),
    ...options,
  });

  try {
    await outbound.raw.get("/campaigns");
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(`${label}: ${vendor.count()} request(s), ${error.code}`);
      console.log(`  ${error.message}`);
      console.log(
        `  timedOut ${error.timedOut}, aborted ${error.aborted}, permanent ${error.permanent}`
      );
    }
  }
};

// The vendor never answers. Each attempt is cut off after `timeout`.
await attempt("timeout", "hang", { retries: 1, timeout: 5000 });

// 500 ms of backoff fits in the deadline. The next 1,000 ms does not.
await attempt("deadline", 503, { deadline: 1200 });

// The third request is never sent.
await attempt("maxRequestsPerCall", 503, { maxRequestsPerCall: 2 });

// No retries at all.
await attempt("retries: 0", 503, { retries: 0 });

// A signal that is already aborted sends nothing.
await attempt("signal", 503, { signal: AbortSignal.abort() });
