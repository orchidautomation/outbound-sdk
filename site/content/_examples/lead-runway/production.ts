import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // Enough for 25 campaigns read with maxLeads 500: 25 x (3 + 5 + 2), plus 3
  // for the list of campaigns.
  maxRequestsPerCall: 260,
  plugins: [insights()],
});
