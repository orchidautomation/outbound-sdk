import { createOutbound, fullJitterBackoff, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "./fake-vendor.ts";
import { instantClock } from "./instant-clock.ts";

const vendor = fakeVendor(503);
const waits: number[] = [];

// Defaults for every call on the instance.
const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: vendor.fetch,
  hooks: {
    onRetry: (event) => {
      waits.push(event.delayMs);
    },
  },
  retries: 2,
  runtime: instantClock(),
  timeout: 10_000,
});

const run = async <Result>(
  label: string,
  call: () => Promise<Result>
): Promise<void> => {
  const before = vendor.count();

  waits.length = 0;

  try {
    await call();
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(`${label}: ${vendor.count() - before} request(s), waits`, [
        ...waits,
      ]);
    }
  }
};

await run("constructor default", () => outbound.raw.get("/campaigns"));

// One call can set its own.
await run("retries: 0", () => outbound.raw.get("/campaigns", { retries: 0 }));

// A policy: how many retries, and how long to wait before each.
await run("fixed 250 ms", () =>
  outbound.raw.get("/campaigns", {
    retries: { backoff: () => 250, max: 3 },
  })
);

// The default backoff, for a policy that only changes `max`.
console.log(
  "default backoff at random 0.5:",
  [1, 2, 3, 4, 5, 6, 7, 8]
    .map((attempt) => fullJitterBackoff(attempt, 0.5))
    .join(", ")
);
