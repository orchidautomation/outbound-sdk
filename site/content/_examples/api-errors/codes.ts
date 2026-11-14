import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { demoData, memory } from "outbound-sdk/memory";

import { fakeVendor } from "../retries/fake-vendor.ts";
import type { Answer } from "../retries/fake-vendor.ts";
import { instantClock } from "../retries/instant-clock.ts";

const show = async <Result>(call: () => Promise<Result>): Promise<void> => {
  try {
    await call();
  } catch (error) {
    // The one check you need. It also holds across two copies of the package.
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${error.code}: ${error.message}`);
    console.log(
      `  status ${error.status}, provider ${error.provider}, permanent ${error.permanent}, retryAfterMs ${error.retryAfterMs}`
    );
  }
};

// Thrown by the SDK itself, before any request.
const local = createOutbound({
  adapter: memory({
    capabilities: { "senders.health": false },
    data: demoData(),
  }),
});

await show(() => local.leads.list({ since: "last tuesday" }));

await show(() => local.sender("mbx_1").health());

await show(() => local.campaigns.get("cmp_gone"));

// Mapped from the vendor's HTTP status. The vendor here is a stand-in that
// answers with a status code and an empty body.
const remote = (answer: Answer) =>
  createOutbound({
    adapter: instantly({ apiKey: "example-key" }),
    fetch: fakeVendor(answer).fetch,
    retries: 1,
    runtime: instantClock(),
  });

await show(() => remote(401).raw.get("/campaigns"));

await show(() => remote(404).raw.get("/campaigns/none"));

await show(() => remote(422).raw.get("/campaigns"));

await show(() =>
  remote({ headers: { "retry-after": "30" }, status: 429 }).raw.get(
    "/campaigns"
  )
);

await show(() => remote(502).raw.get("/campaigns"));

// Instantly answers 402 when a plan does not include an endpoint.
await show(() => remote(402).raw.get("/campaigns"));
