import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { fixtureFetch, requests } from "./fixture-fetch.ts";

const outbound = createOutbound({ adapter: heyreach(), fetch: fixtureFetch });

// Some of these calls throw before they return a promise, so each is made
// inside the function that catches.
const attempt = async (
  label: string,
  call: () => Promise<object | null>
): Promise<void> => {
  try {
    await call();
    console.log(`${label}: ok`);
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code}: ${error.message}`);
  }
};

// 1. A write is refused. The catalog holds no write, and `raw` checks the
//    method and path against the vendor's known reads.
await attempt("pause a campaign", async () => ({
  answer: await outbound.raw.request("POST", "/campaign/Pause", {
    query: { campaignId: 274_079 },
  }),
}));

await attempt("delete a webhook", async () => ({
  answer: await outbound.raw.request("DELETE", "/webhooks/DeleteWebhook"),
}));

// 2. A read that would return a secret is refused too.
await attempt("read API keys", async () => ({
  answer: await outbound.raw.get(
    "/management/organizations/api-keys/workspaces/1"
  ),
}));

// 3. A name that is not in the catalog, a parameter the read does not take,
//    a missing required parameter and a value of the wrong type.
await attempt("unknown read", () => outbound.native.read("pauseCampaign"));

await attempt("unknown parameter", () =>
  outbound.native.read("listsForLead", { page: 2 })
);

await attempt("missing parameter", () =>
  outbound.native.read("campaignSequenceV2")
);

await attempt("wrong type", () =>
  outbound.native.read("campaignSequenceV2", { campaignId: "274079" })
);

// 4. With the redact plugin on, vendor reads are off: the payload is not
//    normalized, so it cannot be masked.
const masked = createOutbound({
  adapter: heyreach(),
  fetch: fixtureFetch,
  plugins: [redact()],
});

await attempt("with redact", () => masked.native.read("checkApiKey"));

// 5. The in-memory adapter has no vendor behind it, so no catalog and no raw.
const local = createOutbound({ adapter: memory() });

console.log("memory:", Object.keys(local.native.catalog).length, "reads");

await attempt("memory native", () => local.native.read("anything"));

await attempt("memory raw", async () => ({
  answer: await local.raw.get("/anything"),
}));

// 6. The vendor answers 404: a normalized error, after one request.
await attempt("vendor 404", () => outbound.native.read("proxyCountries"));

console.log("requests made:", requests);
