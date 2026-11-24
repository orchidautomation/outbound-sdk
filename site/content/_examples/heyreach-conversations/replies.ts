import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

import { fixtureFetch } from "../_shared/fixture-fetch.ts";
import { ROUTES } from "./routes.ts";

// The real HeyReach adapter. Its fetch answers from documented example
// payloads; set HEYREACH_API_KEY and drop the fetch option for real data.
const vendor = fixtureFetch("heyreach", ROUTES);

const outbound = createOutbound({
  adapter: heyreach({ apiKey: "not-used" }),
  fetch: vendor.fetch,
});

// Campaign replies: the campaigns first, then each one's conversations.
for await (const reply of outbound.replies.listAll()) {
  console.log(
    reply.campaignRef,
    reply.threadId,
    reply.category,
    `(${reply.categorySource})`
  );
}

console.log(`${vendor.requests.length} requests:`);

for (const request of vendor.requests) {
  console.log(`  ${request}`);
}
