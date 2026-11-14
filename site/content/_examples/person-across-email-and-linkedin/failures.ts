import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { outbound } from "./agency.ts";
import { DANA, emailTool } from "./seed.ts";

// 1. A name is not an identifier. Nothing is matched by name.
try {
  await outbound.insights.personSummary({ person: "Dana Whitfield" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("a name:", error.code, "-", error.message);
  }
}

// 2. Nobody carries the identifier. That is an answer, not an error.
const nobody = await outbound.insights.personSummary({
  person: "nobody@example.com",
});

console.log("nobody:", nobody.data.found, nobody.data.totals.campaigns);

// 3. More campaigns than the cap: the answer covers part of them and says so.
const capped = await outbound.insights.personSummary({
  max_campaigns: 1,
  person: DANA,
});

console.log(
  "capped:",
  capped.data.campaigns.length,
  capped.meta.complete,
  capped.meta.notes
);

// 4. An adapter that cannot look a lead up by identifier refuses the insight.
const noLookup = createOutbound({
  adapter: memory({ capabilities: { "leads.lookup": false }, data: emailTool }),
  plugins: [insights()],
});

try {
  await noLookup.insights.personSummary({ person: DANA });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no lookup:", error.code, "-", error.message);
  }
}
