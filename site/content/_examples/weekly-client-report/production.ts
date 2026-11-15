import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // One report may spend at most 120 vendor requests.
  maxRequestsPerCall: 120,
  plugins: [insights()],
});
