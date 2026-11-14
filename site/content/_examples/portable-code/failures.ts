import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// A real HeyReach adapter with a `fetch` that counts. Nothing below reaches
// it: a call the adapter does not declare is refused before any request.
let requests = 0;

const outbound = createOutbound({
  adapter: heyreach(),
  fetch: () => {
    requests += 1;

    return Promise.resolve(Response.json({}));
  },
});

// Some refusals are thrown by the call itself and some reject the promise it
// returns, so the call is made inside the function that catches.
const refused = async (
  label: string,
  read: () => Promise<object>
): Promise<void> => {
  try {
    await read();
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code}, permanent ${error.permanent}`);
    console.log(`  ${error.message}`);
  }
};

// 1. A read the vendor does not have.
await refused("settings", () => outbound.campaign("274079").settings());

// 2. A stat scope the vendor does not report.
await refused("by step", () =>
  outbound.campaign("274079").stats({ scope: "step" })
);

// 3. A filter the vendor cannot apply. It is refused, not ignored.
await refused("by category", () =>
  outbound.replies.list({ category: "positive" })
);

// 4. A listing the vendor does not offer in that form.
await refused("every lead", () => outbound.leads.list());

console.log("requests made:", requests);

// 5. A capability you turn off yourself is refused the same way, which is
//    how to test the unsupported branch of your own code.
const limited = createOutbound({
  adapter: memory({ capabilities: { "stats.campaign": false }, data: seed }),
});

await refused("turned off", () => limited.campaign("cmp_founders").stats());
