import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

import { fakeVendor } from "../retries/fake-vendor.ts";
import type { Answer } from "../retries/fake-vendor.ts";
import { instantClock } from "../retries/instant-clock.ts";

const show = async (
  label: string,
  answer: Answer,
  signal?: AbortSignal
): Promise<void> => {
  const outbound = createOutbound({
    adapter: instantly({ apiKey: "example-key" }),
    fetch: fakeVendor(answer).fetch,
    retries: 1,
    runtime: instantClock(),
    timeout: 2000,
  });

  try {
    await outbound.raw.get("/campaigns", { signal });
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(`${label}: ${error.code}, ${error.message}`);
      console.log(
        `  timedOut ${error.timedOut}, aborted ${error.aborted}, permanent ${error.permanent}, cause`,
        error.cause instanceof Error ? error.cause.message : error.cause
      );
    }
  }
};

await show("no answer", "hang");

await show("no connection", "offline");

// The caller gives up while the request is in flight.
const controller = new AbortController();

setTimeout(() => {
  controller.abort();
}, 0);

await show("caller aborted", "hang", controller.signal);
