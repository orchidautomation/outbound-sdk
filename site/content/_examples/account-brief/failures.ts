import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { DOMAIN, emailTool } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: emailTool, workspaceId: "agency" }),
  plugins: [insights()],
});

// 1. An email provider's domain is not one company.
try {
  await outbound.insights.accountSummary({ domain: "someone@gmail.com" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("free domain:", error.code, "-", error.message);
  }
}

// 2. A company name is not a domain. Nothing is matched by name.
try {
  await outbound.insights.accountSummary({ domain: "Northwind" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("a name:", error.code, "-", error.message);
  }
}

// 3. Nobody at the domain. That is an answer, not an error.
const nobody = await outbound.insights.accountSummary({
  domain: "initech.example",
});

console.log(
  "nobody:",
  nobody.data.totals.people,
  "people in",
  nobody.data.totals.leadsRead,
  "leads read"
);

// 4. max_leads stopped the read: people past the cap are missing.
const capped = await outbound.insights.accountSummary({
  domain: DOMAIN,
  max_leads: 2,
});

console.log(
  "capped:",
  capped.data.totals.people,
  capped.meta.complete,
  capped.meta.notes
);

// 5. An adapter that can list leads neither way refuses the insight.
const noLeads = createOutbound({
  adapter: memory({
    capabilities: { "leads.byCampaign": false, "leads.list": false },
    data: emailTool,
  }),
  plugins: [insights()],
});

try {
  await noLeads.insights.accountSummary({ domain: DOMAIN });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no leads:", error.code, "-", error.message);
  }
}
