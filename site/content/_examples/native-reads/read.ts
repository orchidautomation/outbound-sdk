import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

import { fixtureFetch, requests } from "./fixture-fetch.ts";

// `fetch` is injected so the sample needs no network. Leave it out in your code.
const outbound = createOutbound({ adapter: heyreach(), fetch: fixtureFetch });

// 1. A typed read. The parameters are checked by the compiler against the
//    catalog entry: `limit: "10"` or an unknown key would not compile.
const campaigns = await outbound.native.reads.campaignsForLead({
  email: "alex@example.com",
  limit: 10,
});

console.log(campaigns.data);

console.log(campaigns.meta);

// 2. The same client by a name learned at run time, for example from a
//    model or a config file. The parameters are checked when it runs.
const lists = await outbound.native.read("listsForLead", {
  email: "alex@example.com",
});

console.log(lists.data);

// 3. Any other read path on the vendor's API, as the vendor documents it.
const campaign = await outbound.raw.get("/campaign/GetById", {
  query: { campaignId: 274_079 },
});

console.log(campaign);

console.log(requests);
