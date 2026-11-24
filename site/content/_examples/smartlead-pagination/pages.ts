import { createOutbound } from "outbound-sdk";
import { smartlead } from "outbound-sdk/smartlead";

import { fixtureFetch } from "../_shared/fixture-fetch.ts";
import { ROUTES } from "./routes.ts";

// The real Smartlead adapter. Its fetch answers from documented example
// payloads; set SMARTLEAD_API_KEY and drop the fetch option for real data.
const vendor = fixtureFetch("smartlead", ROUTES);

const outbound = createOutbound({
  adapter: smartlead({ apiKey: "not-used" }),
  fetch: vendor.fetch,
});

// Campaigns: one request, however many there are.
const campaigns = await outbound.campaigns.listAll().toArray();

console.log(`${campaigns.length} campaigns`);

// One campaign's leads: every page, until a page is short.
const leads = await outbound.campaign("372").leads.listAll().toArray();

console.log(`${leads.length} leads in campaign 372`);

console.log(`${vendor.requests.length} requests:`);

for (const request of vendor.requests) {
  console.log(`  ${request}`);
}
